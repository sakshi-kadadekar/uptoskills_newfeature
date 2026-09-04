import { z } from 'zod';
import { audit } from '../services/audit.service.js';
import { createExitWorkflowForIntern } from '../services/exitWorkflow.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import prisma from '../utils/prisma.js';

const adminRoles = ['SUPER_ADMIN', 'ADMIN'];
const isAdmin = (role) => adminRoles.includes(role);

async function canAccessIntern(req, internId) {
  if (req.user.id === internId || isAdmin(req.user.role)) return true;
  if (req.user.role !== 'MENTOR') return false;
  return !!(await prisma.internProfile.findFirst({ where: { userId: internId, mentorId: req.user.id } }));
}

async function getIntern(internId) {
  const intern = await prisma.user.findUnique({
    where: { id: internId },
    select: { id: true, name: true, email: true, role: true, status: true, internProfile: { select: { endDate: true } } },
  });
  if (!intern || intern.role !== 'INTERN') throw ApiError.notFound('Intern not found');
  return intern;
}

export const getExitStatus = asyncHandler(async (req, res) => {
  const { internId } = req.validatedParams;
  if (!(await canAccessIntern(req, internId))) throw ApiError.forbidden();
  const [checklist, feedback] = await Promise.all([
    prisma.exitChecklist.findUnique({ where: { internId }, include: { items: { orderBy: { order: 'asc' } } } }),
    prisma.exitFeedback.findUnique({ where: { internId }, select: { id: true } }),
  ]);
  res.json({ checklist, feedbackSubmitted: !!feedback });
});

export const triggerExitWorkflow = asyncHandler(async (req, res) => {
  const intern = await getIntern(req.validatedParams.internId);
  const checklist = await createExitWorkflowForIntern(intern);
  await audit({ userId: req.user.id, action: 'exit.trigger', resource: 'exitChecklist', resourceId: checklist.id, req });
  res.json({ checklist });
});

export const updateChecklistItem = asyncHandler(async (req, res) => {
  const { itemId } = req.validatedParams;
  const item = await prisma.exitChecklistItem.findUnique({ where: { id: itemId }, include: { checklist: true } });
  if (!item) throw ApiError.notFound('Checklist item not found');
  if (!(await canAccessIntern(req, item.checklist.internId))) throw ApiError.forbidden();

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.exitChecklistItem.update({
      where: { id: itemId },
      data: { isCompleted: req.body.isCompleted, completedAt: req.body.isCompleted ? new Date() : null },
    });
    const items = await tx.exitChecklistItem.findMany({ where: { exitChecklistId: item.exitChecklistId } });
    const allDone = items.every((entry) => entry.isCompleted);
    const anyDone = items.some((entry) => entry.isCompleted);
    await tx.exitChecklist.update({
      where: { id: item.exitChecklistId },
      data: { status: allDone ? 'COMPLETED' : anyDone ? 'IN_PROGRESS' : 'PENDING', completedAt: allDone ? new Date() : null },
    });
    return changed;
  });
  res.json({ item: updated });
});

export const submitFeedback = asyncHandler(async (req, res) => {
  const { internId } = req.validatedParams;
  if (req.user.id !== internId) throw ApiError.forbidden('Only the intern can submit exit feedback');
  await getIntern(internId);
  const existing = await prisma.exitFeedback.findUnique({ where: { internId } });
  if (existing) throw ApiError.conflict('Feedback already submitted');
  const feedback = await prisma.exitFeedback.create({ data: { internId, ...req.body } });
  res.status(201).json({ feedback });
});

export const listExitWorkflows = asyncHandler(async (req, res) => {
  const where = req.user.role === 'MENTOR'
    ? { intern: { internProfile: { mentorId: req.user.id } } }
    : {};
  const checklists = await prisma.exitChecklist.findMany({
    where,
    include: {
      intern: { select: { id: true, name: true, email: true, internProfile: { select: { endDate: true } } } },
      items: { orderBy: { order: 'asc' } },
    },
    orderBy: { triggeredAt: 'desc' },
  });
  res.json({ checklists });
});

export const exitInternIdSchema = z.object({ internId: z.string().cuid() });
export const exitItemIdSchema = z.object({ itemId: z.string().cuid() });

export default { getExitStatus, triggerExitWorkflow, updateChecklistItem, submitFeedback, listExitWorkflows };
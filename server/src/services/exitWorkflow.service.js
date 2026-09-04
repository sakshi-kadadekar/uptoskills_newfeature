import prisma from '../utils/prisma.js';
import { notify } from './notification.service.js';

export const TRIGGER_WINDOW_DAYS = 7;

const DEFAULT_CHECKLIST_ITEMS = [
  { label: 'Submit final project report', category: 'Mentor', order: 1 },
  { label: 'Return company assets (laptop, ID card, access badge)', category: 'Admin', order: 2 },
  { label: 'Revoke system/tool access (email, GitHub, Slack)', category: 'IT', order: 3 },
  { label: 'Conduct exit interview with mentor', category: 'Mentor', order: 4 },
  { label: 'Complete offboarding paperwork / NDA acknowledgment', category: 'HR', order: 5 },
  { label: 'Update final attendance & performance records', category: 'HR', order: 6 },
  { label: 'Fill out exit feedback survey', category: 'Intern', order: 7 },
];

export async function createExitWorkflowForIntern(intern) {
  const existing = await prisma.exitChecklist.findUnique({ where: { internId: intern.id } });
  if (existing) return existing;

  const checklist = await prisma.exitChecklist.create({
    data: {
      internId: intern.id,
      items: { create: DEFAULT_CHECKLIST_ITEMS },
    },
    include: { items: { orderBy: { order: 'asc' } } },
  });

  await notify(intern.id, {
    type: 'exit',
    title: 'Your internship offboarding checklist is ready',
    body: 'Please complete your offboarding checklist and exit feedback survey before your last day.',
    link: '/exit',
  });
  return checklist;
}

export async function runDailyExitScan() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + TRIGGER_WINDOW_DAYS);
  const interns = await prisma.user.findMany({
    where: {
      role: 'INTERN',
      status: 'ACTIVE',
      internProfile: { endDate: { gte: today, lte: windowEnd } },
    },
    select: { id: true, name: true },
  });

  const results = [];
  for (const intern of interns) {
    const checklist = await createExitWorkflowForIntern(intern);
    results.push({ internId: intern.id, checklistId: checklist.id });
  }
  return results;
}
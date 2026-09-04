import { audit } from '../services/audit.service.js';
import { notify } from '../services/notification.service.js';
import { emitToRoom, getIO } from '../sockets/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import prisma from '../utils/prisma.js';

const MAX_LEAVE_SPAN_DAYS = 60;

const toUtcDate = (value) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const daysBetweenInclusive = (start, end) =>
  Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

const enumerateDays = (start, end) => {
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

async function syncAttendanceForLeave(leave, reviewerId) {
  const start = toUtcDate(leave.startDate);
  const end = toUtcDate(leave.endDate);
  await Promise.all(enumerateDays(start, end).map((date) => prisma.attendance.upsert({
    where: { userId_date: { userId: leave.userId, date } },
    update: { status: 'LEAVE', notes: `Approved leave: ${leave.type}`, markedById: reviewerId },
    create: {
      userId: leave.userId,
      date,
      status: 'LEAVE',
      notes: `Approved leave: ${leave.type}`,
      markedById: reviewerId,
    },
  })));
}

async function clearAttendanceForLeave(leave) {
  await prisma.attendance.deleteMany({
    where: {
      userId: leave.userId,
      date: { gte: toUtcDate(leave.startDate), lte: toUtcDate(leave.endDate) },
      status: 'LEAVE',
      notes: { startsWith: 'Approved leave:' },
    },
  });
}

export const list = asyncHandler(async (req, res) => {
  const { page, limit, sort = 'createdAt', order } = req.validatedQuery;
  const where = {};
  if (req.user.role === 'INTERN') {
    where.userId = req.user.id;
  } else if (req.user.role === 'MENTOR') {
    const interns = await prisma.user.findMany({
      where: { role: 'INTERN', internProfile: { mentorId: req.user.id } },
      select: { id: true },
    });
    where.userId = { in: [...interns.map(({ id }) => id), req.user.id] };
  }
  if (req.query.userId && req.user.role !== 'INTERN') where.userId = req.query.userId;
  if (req.query.status) where.status = req.query.status;
  if (req.query.type) where.type = req.query.type;

  const [items, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, department: true } },
        reviewer: { select: { id: true, name: true } },
      },
    }),
    prisma.leaveRequest.count({ where }),
  ]);
  res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
});

export const getById = asyncHandler(async (req, res) => {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: req.validatedParams.id },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true, department: true, email: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });
  if (!leave) throw ApiError.notFound();
  const isReviewer = ['SUPER_ADMIN', 'ADMIN'].includes(req.user.role);
  let isMentor = false;
  if (leave.userId !== req.user.id && !isReviewer && req.user.role === 'MENTOR') {
    isMentor = !!(await prisma.internProfile.findFirst({ where: { userId: leave.userId, mentorId: req.user.id } }));
  }
  if (leave.userId !== req.user.id && !isReviewer && !isMentor) throw ApiError.forbidden();
  res.json({ leave });
});

export const create = asyncHandler(async (req, res) => {
  const { type, startDate, endDate, reason } = req.body;
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (end < start) throw ApiError.badRequest('endDate must be on or after startDate');
  const days = daysBetweenInclusive(start, end);
  if (days > MAX_LEAVE_SPAN_DAYS) throw ApiError.badRequest(`Leave requests cannot span more than ${MAX_LEAVE_SPAN_DAYS} days`);
  const overlap = await prisma.leaveRequest.findFirst({
    where: { userId: req.user.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } },
  });
  if (overlap) throw ApiError.conflict('You already have a leave request that overlaps these dates');
  const leave = await prisma.leaveRequest.create({ data: { userId: req.user.id, type, startDate: start, endDate: end, days, reason } });
  await audit({ userId: req.user.id, action: 'leave.create', resource: 'leave', resourceId: leave.id, meta: { type, days }, req });
  const profile = await prisma.internProfile.findUnique({ where: { userId: req.user.id } });
  const recipients = profile?.mentorId
    ? [profile.mentorId]
    : (await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, select: { id: true } })).map(({ id }) => id);
  await Promise.all(recipients.map((id) => notify(id, {
    type: 'leave',
    title: `${req.user.name} requested ${days}-day leave`,
    body: `${type} · ${reason.slice(0, 120)}`,
    link: `/leave/${leave.id}`,
  })));
  emitToRoom('role:MENTOR', 'dashboard:refresh', {});
  emitToRoom('role:ADMIN', 'dashboard:refresh', {});
  res.status(201).json({ leave });
});

export const review = asyncHandler(async (req, res) => {
  const { id } = req.validatedParams;
  const { status, reviewNote } = req.body;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) throw ApiError.notFound();
  if (leave.status !== 'PENDING') throw ApiError.conflict(`Request is already ${leave.status.toLowerCase()}`);
  if (req.user.role === 'MENTOR') {
    const intern = await prisma.internProfile.findFirst({ where: { userId: leave.userId, mentorId: req.user.id } });
    if (!intern) throw ApiError.forbidden('Not your intern');
  }
  const updated = await prisma.leaveRequest.update({ where: { id }, data: { status, reviewNote, reviewedById: req.user.id, reviewedAt: new Date() } });
  if (status === 'APPROVED') await syncAttendanceForLeave(updated, req.user.id);
  await audit({ userId: req.user.id, action: 'leave.review', resource: 'leave', resourceId: id, meta: { status }, req });
  await notify(updated.userId, { type: 'leave', title: `Your leave request was ${status.toLowerCase()}`, body: reviewNote || `${updated.type} · ${updated.days} day(s)`, link: `/leave/${updated.id}` });
  getIO()?.to(`user:${updated.userId}`).emit('leave:reviewed', { leaveId: updated.id, status });
  emitToRoom('role:MENTOR', 'dashboard:refresh', {});
  emitToRoom('role:ADMIN', 'dashboard:refresh', {});
  emitToRoom('role:SUPER_ADMIN', 'dashboard:refresh', {});
  res.json({ leave: updated });
});

export const cancel = asyncHandler(async (req, res) => {
  const { id } = req.validatedParams;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) throw ApiError.notFound();
  const isOwn = leave.userId === req.user.id;
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(req.user.role);
  if (!isOwn && !isAdmin) throw ApiError.forbidden();
  if (!['PENDING', 'APPROVED'].includes(leave.status)) throw ApiError.conflict('Only pending or approved requests can be cancelled');
  const updated = await prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', reviewedAt: new Date(), reviewedById: isAdmin ? req.user.id : leave.reviewedById } });
  if (leave.status === 'APPROVED') await clearAttendanceForLeave(updated);
  await audit({ userId: req.user.id, action: 'leave.cancel', resource: 'leave', resourceId: id, req });
  res.json({ leave: updated });
});

export const remove = asyncHandler(async (req, res) => {
  const { id } = req.validatedParams;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) throw ApiError.notFound();
  if (leave.status === 'APPROVED') await clearAttendanceForLeave(leave);
  await prisma.leaveRequest.delete({ where: { id } });
  await audit({ userId: req.user.id, action: 'leave.delete', resource: 'leave', resourceId: id, req });
  res.json({ ok: true });
});

export const stats = asyncHandler(async (req, res) => {
  const where = req.user.role === 'INTERN' ? { userId: req.user.id } : {};
  const [total, pending, approved, rejected, cancelled] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.count({ where: { ...where, status: 'PENDING' } }),
    prisma.leaveRequest.count({ where: { ...where, status: 'APPROVED' } }),
    prisma.leaveRequest.count({ where: { ...where, status: 'REJECTED' } }),
    prisma.leaveRequest.count({ where: { ...where, status: 'CANCELLED' } }),
  ]);
  const daysTakenAgg = await prisma.leaveRequest.aggregate({ where: { ...where, status: 'APPROVED' }, _sum: { days: true } });
  res.json({ total, pending, approved, rejected, cancelled, daysTaken: daysTakenAgg._sum.days ?? 0 });
});

export default { list, getById, create, review, cancel, remove, stats };
import { CalendarOff, Loader2, Plus, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../../lib/api';
import notify from '../../lib/toast';
import { formatDate, formatRelative } from '../../lib/utils';
import { Badge, Card, GreenButton, Input, Modal, SectionHeader } from '../../shared/components/UI';

const TYPES = ['CASUAL', 'SICK', 'VACATION', 'EMERGENCY', 'OTHER'];
const VARIANTS = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'default' };

const Leave = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: 'CASUAL', startDate: '', endDate: '', reason: '' });
  const load = async () => {
    try { setItems((await api.get('/leave', { params: { limit: 50 } })).data.items); }
    catch { notify.error('Failed to load leave requests.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const submit = async () => {
    if (!form.startDate || !form.endDate || form.endDate < form.startDate || form.reason.trim().length < 3) {
      notify.error('Choose valid dates and provide a reason.'); return;
    }
    setBusy(true);
    try { await api.post('/leave', form); notify.success('Leave request submitted.'); setOpen(false); setForm({ type: 'CASUAL', startDate: '', endDate: '', reason: '' }); load(); }
    catch (error) { notify.error(error.response?.data?.error || 'Failed to submit leave request.'); }
    finally { setBusy(false); }
  };
  const cancel = async (id) => {
    try { await api.post(`/leave/${id}/cancel`); notify.success('Request cancelled.'); load(); }
    catch (error) { notify.error(error.response?.data?.error || 'Failed to cancel request.'); }
  };
  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="animate-spin" size={28} /></div>;
  return <div className="space-y-6">
    <SectionHeader title="Leave & Time Off" subtitle="Request leave and track approval status" action={<button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium" style={{ background: '#ff6d34' }}><Plus size={15} /> Request Leave</button>} />
    <div className="space-y-3">
      {items.map((leave) => <Card key={leave.id} className="p-5"><div className="flex flex-col sm:flex-row sm:items-center gap-4"><div className="flex items-start gap-4 flex-1"><CalendarOff size={22} className="mt-1" /><div><h3 className="font-semibold">{leave.type.charAt(0) + leave.type.slice(1).toLowerCase()} leave · {leave.days} day{leave.days > 1 ? 's' : ''}</h3><p className="text-xs text-slate-400">{formatDate(leave.startDate)} - {formatDate(leave.endDate)} · {formatRelative(leave.createdAt)}</p><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{leave.reason}</p>{leave.reviewNote && <p className="text-xs italic mt-1" style={{ color: 'var(--muted)' }}>Reviewer note: {leave.reviewNote}</p>}</div></div><div className="flex items-center gap-2"><Badge variant={VARIANTS[leave.status]}>{leave.status}</Badge>{['PENDING', 'APPROVED'].includes(leave.status) && <button onClick={() => cancel(leave.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg"><XCircle size={13} /> Cancel</button>}</div></div></Card>)}
      {!items.length && <div className="text-center py-16 text-slate-400"><CalendarOff size={40} className="mx-auto mb-3 opacity-30" /><p>No leave requests yet.</p></div>}
    </div>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Request Leave" footer={<><button onClick={() => setOpen(false)} className="px-4 py-2 text-sm">Cancel</button><GreenButton onClick={submit}>{busy ? 'Submitting...' : 'Submit Request'}</GreenButton></>}>
      <div className="space-y-4"><label className="text-xs font-semibold block">Leave type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="w-full mt-1 px-3 py-2 rounded-lg border">{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><Input label="Start date" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /><Input label="End date" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></div><label className="text-xs font-semibold block">Reason<textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} rows={4} className="w-full mt-1 px-3 py-2 rounded-lg border" /></label></div>
    </Modal>
  </div>;
};
export default Leave;
import { CheckSquare, ClipboardCheck, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import api from '../../lib/api';
import notify from '../../lib/toast';
import { formatDate } from '../../lib/utils';
import { Badge, Card, GreenButton, SectionHeader } from './UI';
import { useAuthStore } from '../../lib/auth';

const statusVariant = { PENDING: 'warning', IN_PROGRESS: 'warning', COMPLETED: 'success' };

function Checklist({ checklist, onToggle }) {
  return <Card className="p-5">
    <div className="flex items-center justify-between gap-3 mb-4">
      <h2 className="font-semibold flex items-center gap-2"><ClipboardCheck size={19} /> Offboarding checklist</h2>
      <Badge variant={statusVariant[checklist.status]}>{checklist.status.replace('_', ' ')}</Badge>
    </div>
    <div className="space-y-2">
      {checklist.items.map((item) => <label key={item.id} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer">
        <input type="checkbox" checked={item.isCompleted} onChange={() => onToggle(item)} className="mt-1" />
        <span className={item.isCompleted ? 'line-through opacity-60' : ''}>{item.label}<span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>{item.category}</span></span>
      </label>)}
    </div>
  </Card>;
}

function FeedbackForm({ onSubmitted }) {
  const [form, setForm] = useState({ overallRating: 5, mentorshipRating: 5, wouldRecommend: true, whatWentWell: '', whatCouldImprove: '', additionalComments: '' });
  const [busy, setBusy] = useState(false);
  const update = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value }));
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try { await api.post(`/exit/${useAuthStore.getState().user.id}/feedback`, form); notify.success('Exit feedback submitted.'); onSubmitted(); }
    catch (error) { notify.error(error.response?.data?.error || 'Failed to submit feedback.'); }
    finally { setBusy(false); }
  };
  return <Card className="p-5"><h2 className="font-semibold mb-4">Exit feedback survey</h2><form onSubmit={submit} className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[['overallRating', 'Overall experience'], ['mentorshipRating', 'Mentorship quality']].map(([name, label]) => <label key={name} className="text-xs font-semibold">{label} (1-5)<input className="w-full mt-1 px-3 py-2 rounded-lg border" type="number" name={name} min="1" max="5" value={form[name]} onChange={update} required /></label>)}</div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wouldRecommend" checked={form.wouldRecommend} onChange={update} /> Would recommend this internship</label>
    {['whatWentWell', 'whatCouldImprove', 'additionalComments'].map((name) => <label key={name} className="block text-xs font-semibold">{name === 'whatWentWell' ? 'What went well?' : name === 'whatCouldImprove' ? 'What could be improved?' : 'Additional comments'}<textarea name={name} value={form[name]} onChange={update} rows={3} className="w-full mt-1 px-3 py-2 rounded-lg border" /></label>)}
    <GreenButton type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Submit feedback'}</GreenButton>
  </form></Card>;
}

const ExitWorkflowPage = () => {
  const user = useAuthStore((state) => state.user);
  const isIntern = user?.role === 'INTERN';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedbackDone, setFeedbackDone] = useState(false);

  const load = async () => {
    try { setData((await api.get(isIntern ? `/exit/${user.id}` : '/exit/admin')).data); }
    catch (error) { notify.error(error.response?.data?.error || 'Failed to load offboarding workflows.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [user?.id, isIntern]);
  const toggleItem = async (item) => {
    try { await api.patch(`/exit/checklist-item/${item.id}`, { isCompleted: !item.isCompleted }); await load(); }
    catch { notify.error('Failed to update checklist item.'); }
  };
  const trigger = async (internId) => {
    try { await api.post(`/exit/${internId}/trigger`); notify.success('Offboarding workflow triggered.'); await load(); }
    catch (error) { notify.error(error.response?.data?.error || 'Failed to trigger workflow.'); }
  };
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin" size={28} /></div>;
  if (isIntern) return <div className="space-y-6"><SectionHeader title="Offboarding" subtitle="Complete your internship exit checklist and feedback." />{data?.checklist ? <><Checklist checklist={data.checklist} onToggle={toggleItem} />{!data.feedbackSubmitted && !feedbackDone ? <FeedbackForm onSubmitted={() => setFeedbackDone(true)} /> : <Card className="p-5 text-sm"><CheckSquare size={18} className="inline mr-2 text-emerald-500" />Feedback has been recorded. Thank you.</Card>}</> : <Card className="p-8 text-center" style={{ color: 'var(--muted)' }}>Your offboarding checklist will appear when your internship is nearing its end.</Card>}</div>;
  const workflows = data?.checklists ?? [];
  return <div className="space-y-6"><SectionHeader title="Offboarding" subtitle="Monitor internship exit workflows." />{workflows.map((workflow) => <Card key={workflow.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-3 mb-3"><div><h2 className="font-semibold">{workflow.intern.name}</h2><p className="text-xs" style={{ color: 'var(--muted)' }}>{workflow.intern.email} · End date: {formatDate(workflow.intern.internProfile?.endDate)}</p></div><Badge variant={statusVariant[workflow.status]}>{workflow.status.replace('_', ' ')}</Badge></div><div className="space-y-1">{workflow.items.map((item) => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" checked={item.isCompleted} onChange={() => toggleItem(item)} />{item.label}</label>)}</div></Card>)}{!workflows.length && <Card className="p-8 text-center" style={{ color: 'var(--muted)' }}>No offboarding workflows have been triggered.</Card>}</div>;
};

export default ExitWorkflowPage;
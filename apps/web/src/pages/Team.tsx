import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Check, Minus, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, type FormSchemaDef, type Role } from '@nexus/shared';
import { inviteMemberSchema } from '@nexus/shared/schemas';
import { del, get, patch, post } from '@/lib/api';
import { initials, fmtDateTime } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { toast } from '@/stores/toasts';
import { Can, useAuth } from '@/features/auth/auth';
import { Modal } from '@/components/Overlay';
import { SchemaForm } from '@/components/SchemaForm';
import { ErrorState, PageHeader, Panel, TableSkeleton } from '@/components/primitives';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Member { id: string; name: string; email: string; role: Role; joinedAt: string }
const inviteForm: FormSchemaDef = { id: 'invite', fields: [
  { name: 'name', label: 'Full name', type: 'text' }, { name: 'email', label: 'Email', type: 'text', placeholder: 'person@company.com' },
  { name: 'role', label: 'Role', type: 'select', defaultValue: 'engineer', options: ROLES.map((r) => ({ value: r, label: r[0]!.toUpperCase() + r.slice(1) })) },
  { name: 'password', label: 'Initial password', type: 'text', help: 'At least 10 characters. Share it securely; the member should change it after first sign-in.' },
] };

export default function Team() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['team'], queryFn: () => get<{ items: Member[] }>('/team') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] });
  const role = useMutation({ mutationFn: (v: { id: string; role: Role }) => patch(`/team/${v.id}`, { role: v.role }), onSuccess: () => { toast.success('Role updated'); void refresh(); }, onError: (e) => toast.error('Could not change role', (e as Error).message) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/team/${id}`), onSuccess: () => { toast.success('Member removed'); void refresh(); }, onError: (e) => toast.error('Could not remove member', (e as Error).message) });
  const add = useMutation({ mutationFn: (v: unknown) => post('/team', v), onSuccess: () => { toast.success('Member added'); setAdding(false); void refresh(); }, onError: (e) => toast.error('Could not add member', (e as Error).message) });
  const canEdit = can('team:write');
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={item}><PageHeader title="Team & Access" description="Members of this organization and what each role may do. Permissions are enforced on the server for every request." actions={<Can permission="team:write"><Button onClick={() => setAdding(true)}><Plus /> Add member</Button></Can>} /></motion.div>
      <motion.div variants={item} className="card">
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead className="hidden sm:table-cell">Joined</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
            <TableBody>{q.data!.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell><div className="flex items-center gap-3"><Avatar className="size-8"><AvatarFallback className="bg-accent text-xs text-accent-foreground">{initials(m.name)}</AvatarFallback></Avatar><div><p className="font-medium">{m.name}{m.id === user.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</p><p className="text-xs text-muted-foreground">{m.email}</p></div></div></TableCell>
                <TableCell>{canEdit && m.id !== user.id ? (
                  <Select value={m.role} onValueChange={(v) => role.mutate({ id: m.id, role: v as Role })}><SelectTrigger size="sm" className="w-32 capitalize" aria-label={`Role for ${m.name}`}><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent></Select>
                ) : <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium capitalize text-accent-foreground">{m.role}</span>}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{fmtDateTime(m.joinedAt)}</TableCell>
                <TableCell>{canEdit && m.id !== user.id && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => { if (confirm(`Remove ${m.name} from this organization?`)) remove.mutate(m.id); }}><Trash2 /></Button>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
        )}
      </motion.div>
      <motion.div variants={item}>
        <Panel title="Role permissions" subtitle="Explicit permission matrix (read-only)" bodyClassName="px-0 pb-0">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Permission</th>{ROLES.map((r) => <th key={r} className="px-3 py-2 text-center font-medium capitalize">{r}</th>)}</tr></thead>
            <tbody>{PERMISSIONS.map((p) => (
              <tr key={p} className="border-b border-border/50 last:border-0"><td className="px-4 py-1.5 font-mono text-xs">{p}</td>{ROLES.map((r) => <td key={r} className="px-3 py-1.5 text-center">{ROLE_PERMISSIONS[r].includes(p) ? <Check aria-label="allowed" className="mx-auto size-4 text-ok" /> : <Minus aria-label="denied" className="mx-auto size-4 text-subtle" />}</td>)}</tr>
            ))}</tbody>
          </table></div>
        </Panel>
      </motion.div>
      <Modal open={adding} onOpenChange={setAdding} title="Add member" description="Creates the account (or attaches an existing one) with the chosen role.">
        <SchemaForm schema={inviteForm} validator={inviteMemberSchema as never} submitLabel="Add member" submitting={add.isPending} onCancel={() => setAdding(false)} onSubmit={(v) => add.mutateAsync(v).then(() => undefined).catch(() => undefined)} />
      </Modal>
    </motion.div>
  );
}

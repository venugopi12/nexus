import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import type { DeploymentDto, FormSchemaDef, Paginated } from '@nexus/shared';
import { deploymentSchema } from '@nexus/shared/schemas';
import { get, post } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { item, stagger } from '@/lib/motion';
import { toast } from '@/stores/toasts';
import { useUi } from '@/stores/ui';
import { useUrlState } from '@/hooks/useUrlState';
import { Can } from '@/features/auth/auth';
import { Modal } from '@/components/Overlay';
import { SchemaForm } from '@/components/SchemaForm';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/primitives';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const form: FormSchemaDef = {
  id: 'deployment',
  fields: [
    { name: 'serviceId', label: 'Service', type: 'service' },
    { name: 'environment', label: 'Environment', type: 'select', defaultValue: 'production', options: [{ value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }] },
    { name: 'version', label: 'Version', type: 'text', placeholder: 'v2.15.0' },
    { name: 'commit', label: 'Commit SHA', type: 'text', placeholder: 'a1b2c3d' },
    { name: 'notes', label: 'Notes', type: 'textarea', help: 'Optional — shows in the deployment timeline.' },
  ],
};
const validator = deploymentSchema.extend({ serviceId: z.string({ error: 'Select a service' }).uuid('Select a service') });
const PAGE = 20;

export default function Deployments() {
  const env = useUi((s) => s.env);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  useEffect(() => { if (params.get('new') === '1') { setOpen(true); setParams({}, { replace: true }); } }, [params, setParams]);
  const [f, set] = useUrlState({ page: '1' });
  const page = Number(f.page);
  const q = useQuery({ queryKey: ['deployments', 'list', env, page], queryFn: () => get<Paginated<DeploymentDto>>('/deployments', { env, page, pageSize: PAGE }), placeholderData: (p) => p });
  const m = useMutation({
    mutationFn: (v: unknown) => post('/deployments', v),
    onSuccess: () => { toast.success('Deployment recorded'); setOpen(false); void qc.invalidateQueries({ queryKey: ['deployments'] }); },
    onError: (e) => toast.error('Could not record deployment', (e as Error).message),
  });
  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={item}><PageHeader title="Deployments" description="Release history for this environment. Deployments are correlated with incidents in the assistant and on service pages." actions={<Can permission="deployment:write"><Button onClick={() => setOpen(true)}><Plus /> Record deployment</Button></Can>} /></motion.div>
      <motion.div variants={item} className="card">
        {q.isLoading ? <TableSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.items.length === 0 ? <EmptyState title="No deployments" /> : (
          <>
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Version</TableHead><TableHead className="hidden sm:table-cell">Commit</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Deployed by</TableHead><TableHead className="text-right">When</TableHead></TableRow></TableHeader>
              <TableBody>{q.data!.items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.serviceName}{d.notes && <span className="block max-w-xs truncate text-xs font-normal text-muted-foreground">{d.notes}</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{d.version}</TableCell><TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{d.commit}</TableCell>
                  <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.status === 'succeeded' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>{d.status.replace('_', ' ')}</span></TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{d.deployedBy}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-muted-foreground" title={fmtDateTime(d.deployedAt)}>{timeAgo(d.deployedAt)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table></div>
            <Pagination page={page} pageSize={PAGE} total={q.data!.total} onPage={(p) => set({ page: String(p) }, { keepPage: true })} />
          </>
        )}
      </motion.div>
      <Modal open={open} onOpenChange={setOpen} title="Record deployment" description="Adds an entry to the deployment history and event stream.">
        <SchemaForm schema={form} validator={validator as never} defaultValues={{ environment: env } as never} submitLabel="Record deployment" submitting={m.isPending} onCancel={() => setOpen(false)} onSubmit={(v) => m.mutateAsync(v).then(() => undefined).catch(() => undefined)} />
      </Modal>
    </motion.div>
  );
}

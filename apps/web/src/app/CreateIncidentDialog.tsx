import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { incidentForm, type IncidentDetailDto } from '@nexus/shared';
import { createIncidentSchema } from '@nexus/shared/schemas';
import { post } from '@/lib/api';
import { useUi } from '@/stores/ui';
import { toast } from '@/stores/toasts';
import { Modal } from '@/components/Overlay';
import { SchemaForm } from '@/components/SchemaForm';

export default function CreateIncidentDialog() {
  const open = useUi((s) => s.createIncidentOpen);
  const setOpen = useUi((s) => s.setCreateIncidentOpen);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const env = useUi((s) => s.env);
  const m = useMutation({
    mutationFn: (v: unknown) => post<IncidentDetailDto>('/incidents', v),
    onSuccess: (inc) => {
      void qc.invalidateQueries({ queryKey: ['incidents'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      setOpen(false);
      toast.success(`INC-${inc.number} created`, inc.title);
      navigate(`/incidents/${inc.id}`);
    },
    onError: (e) => toast.error('Could not create incident', (e as Error).message),
  });
  return (
    <Modal open={open} onOpenChange={setOpen} title="Create incident" description="Declare an incident and start coordinating the response." className="max-w-xl">
      <SchemaForm formId="create-incident" schema={incidentForm} validator={createIncidentSchema as never} defaultValues={{ environment: env } as never} submitLabel="Create incident" submitting={m.isPending} onCancel={() => setOpen(false)} onSubmit={(v) => m.mutateAsync(v).then(() => undefined).catch(() => undefined)} />
    </Modal>
  );
}


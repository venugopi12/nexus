import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import type { FieldDef, FormSchemaDef } from '@nexus/shared';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServices, useTeam } from '@/lib/queries';
import { cn } from '@/lib/utils';

const NONE = '__none__';

interface Option { value: string; label: string; hint?: string }

export function MultiSelect({ value, onChange, options, placeholder, id, invalid, describedBy }: { value: string[]; onChange: (v: string[]) => void; options: Option[]; placeholder: string; id: string; invalid?: boolean; describedBy?: string }) {
  const [q, setQ] = useState('');
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const selected = options.filter((o) => value.includes(o.value));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-invalid={invalid} aria-describedby={describedBy} className="h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal">
          <span className="flex min-w-0 flex-wrap gap-1">
            {selected.length ? selected.map((s) => (
              <span key={s.value} className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">
                {s.label}
                <span role="button" tabIndex={0} aria-label={`Remove ${s.label}`} className="cursor-pointer opacity-70 hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v !== s.value)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(value.filter((v) => v !== s.value)); } }}><X className="size-3" /></span>
              </span>
            )) : <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <div className="border-b p-2"><Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8" aria-label="Filter options" /></div>
        <div className="max-h-60 overflow-y-auto p-1" role="listbox" aria-multiselectable>
          {filtered.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>}
          {filtered.map((o) => {
            const on = value.includes(o.value);
            return (
              <button key={o.value} type="button" role="option" aria-selected={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className={cn('grid size-4 place-items-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>{on && <Check className="size-3" />}</span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SingleSelect({ value, onChange, options, placeholder, id, allowEmpty, invalid, describedBy }: { value: string | null | undefined; onChange: (v: string | null) => void; options: Option[]; placeholder: string; id: string; allowEmpty?: boolean; invalid?: boolean; describedBy?: string }) {
  return (
    <Select value={value ?? (allowEmpty ? NONE : '')} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid} aria-describedby={describedBy}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {allowEmpty && <SelectItem value={NONE}>— None —</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function matches(def: FieldDef, values: Record<string, unknown>): boolean {
  const w = def.showWhen;
  if (!w) return true;
  const v = values[w.field];
  if (w.equals !== undefined) return v === w.equals;
  if (w.notEquals !== undefined) return v !== w.notEquals;
  if (w.in) return w.in.includes(v);
  return true;
}

interface Props<T extends FieldValues> {
  schema: FormSchemaDef;
  validator: ZodType<T>;
  defaultValues?: Partial<T>;
  onSubmit: (values: T) => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
  onCancel?: () => void;
  /** Values forced onto the form from outside, e.g. preselected service. */
  formId?: string;
}

/**
 * Renders a FormSchemaDef (declarative field list) with react-hook-form + zod.
 * Supports conditional visibility, defaults, help text and accessible errors (aria-invalid/describedby/role=alert).
 */
export function SchemaForm<T extends FieldValues>({ schema, validator, defaultValues, onSubmit, submitLabel, submitting, onCancel, formId }: Props<T>) {
  const services = useServices();
  const team = useTeam();
  const defaults = useMemo(() => {
    const d: Record<string, unknown> = {};
    for (const f of schema.fields) if (f.defaultValue !== undefined && d[f.name] === undefined && !f.showWhen) d[f.name] = f.defaultValue;
    for (const f of schema.fields) if (f.defaultValue !== undefined && d[f.name] === undefined) d[f.name] = f.defaultValue;
    for (const f of schema.fields) if (d[f.name] === undefined) d[f.name] = f.type === 'multiselect' || f.type === 'users' || f.type === 'services' ? [] : f.type === 'switch' || f.type === 'checkbox' ? false : f.type === 'service' || f.type === 'user' ? null : '';
    return { ...d, ...defaultValues } as never;
  }, [schema, defaultValues]);

  const form = useForm<T>({ resolver: zodResolver(validator as never) as never, defaultValues: defaults, shouldUnregister: false, mode: 'onTouched' });
  const values = useWatch({ control: form.control }) as Record<string, unknown>;

  // when a conditional duplicate field (same name) becomes the visible one, reset to its default
  const prevVisible = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const f of schema.fields) {
      if (!matches(f, values)) continue;
      const prev = prevVisible.current[f.name];
      if (prev && prev !== f.label && f.defaultValue !== undefined) form.setValue(f.name as never, f.defaultValue as never);
      prevVisible.current[f.name] = f.label;
    }
  }, [schema, values, form]);

  const serviceOptions: Option[] = (services.data?.items ?? []).map((s) => ({ value: s.id, label: s.name, hint: s.kind }));
  const userOptions: Option[] = (team.data?.items ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.role }));
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  return (
    <form id={formId} noValidate onSubmit={form.handleSubmit(async (v) => { await onSubmit(v); })} className="space-y-4 p-5">
      {schema.fields.filter((f) => matches(f, values)).map((f) => {
        const id = `${schema.id}-${f.name}`;
        const err = errors[f.name]?.message as string | undefined;
        const helpId = f.help ? `${id}-help` : undefined;
        const errId = err ? `${id}-err` : undefined;
        const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;
        const common = { id, 'aria-invalid': !!err, 'aria-describedby': describedBy };
        const isToggle = f.type === 'switch' || f.type === 'checkbox';
        return (
          <div key={`${f.name}:${f.label}`} className={cn('space-y-1.5', isToggle && 'flex items-start justify-between gap-4 space-y-0')}>
            <div className={cn(isToggle && 'min-w-0')}>
              <Label htmlFor={id}>{f.label}</Label>
              {f.help && isToggle && <p id={helpId} className="mt-0.5 text-xs text-muted-foreground">{f.help}</p>}
            </div>
            <Controller
              control={form.control}
              name={f.name as never}
              render={({ field }) => {
                const v = field.value as never;
                switch (f.type) {
                  case 'text': return <Input {...common} {...field} value={(v as string) ?? ''} placeholder={f.placeholder} />;
                  case 'textarea': return <Textarea {...common} {...field} value={(v as string) ?? ''} placeholder={f.placeholder} rows={4} />;
                  case 'number': return (
                    <div className="relative">
                      <Input {...common} type="number" inputMode="decimal" min={f.min} max={f.max} value={(v as number | string) ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))} onBlur={field.onBlur} />
                      {f.suffix && <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted-foreground">{f.suffix}</span>}
                    </div>
                  );
                  case 'datetime': return <Input {...common} type="datetime-local" value={(v as string) ?? ''} onChange={field.onChange} onBlur={field.onBlur} />;
                  case 'select': return <SingleSelect id={id} value={v as string} onChange={field.onChange} options={f.options ?? []} placeholder="Select…" invalid={!!err} describedBy={describedBy} />;
                  case 'multiselect': return <MultiSelect id={id} value={(v as string[]) ?? []} onChange={field.onChange} options={f.options ?? []} placeholder="Select…" invalid={!!err} describedBy={describedBy} />;
                  case 'service': return <SingleSelect id={id} allowEmpty value={v as string | null} onChange={field.onChange} options={serviceOptions} placeholder="All services" invalid={!!err} describedBy={describedBy} />;
                  case 'services': return <MultiSelect id={id} value={(v as string[]) ?? []} onChange={field.onChange} options={serviceOptions} placeholder="Select services…" invalid={!!err} describedBy={describedBy} />;
                  case 'user': return <SingleSelect id={id} allowEmpty value={v as string | null} onChange={field.onChange} options={userOptions} placeholder="Unassigned" invalid={!!err} describedBy={describedBy} />;
                  case 'users': return <MultiSelect id={id} value={(v as string[]) ?? []} onChange={field.onChange} options={userOptions} placeholder="Select people…" invalid={!!err} describedBy={describedBy} />;
                  case 'switch': return <Switch id={id} checked={!!v} onCheckedChange={field.onChange} aria-describedby={describedBy} />;
                  case 'checkbox': return <Checkbox id={id} checked={!!v} onCheckedChange={(c) => field.onChange(c === true)} aria-describedby={describedBy} />;
                }
              }}
            />
            {f.help && !isToggle && <p id={helpId} className="text-xs text-muted-foreground">{f.help}</p>}
            {err && <p id={errId} role="alert" className="text-xs font-medium text-destructive">{err}</p>}
          </div>
        );
      })}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</Button>
      </div>
    </form>
  );
}

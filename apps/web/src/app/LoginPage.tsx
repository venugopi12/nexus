import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@nexus/shared';
import { loginSchema, type LoginInput } from '@nexus/shared/schemas';
import { post, errorMessage } from '@/lib/api';
import { meKey, useMe } from '@/features/auth/auth';
import { Logo } from './Sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { item, stagger } from '@/lib/motion';
import { SimulatedTag } from '@/components/primitives';

const DEMO = [
  { email: 'admin@acme.nexus.dev', role: 'Admin', note: 'Full access · also viewer in Globex' },
  { email: 'sre@acme.nexus.dev', role: 'SRE', note: 'Resolve incidents, edit alerts' },
  { email: 'engineer@acme.nexus.dev', role: 'Engineer', note: 'Create & update incidents' },
  { email: 'viewer@acme.nexus.dev', role: 'Viewer', note: 'Read-only' },
  { email: 'admin@globex.nexus.dev', role: 'Globex admin', note: 'Second tenant' },
];

export default function LoginPage() {
  const { data: user } = useMe();
  const navigate = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const res = await post<{ user: SessionUser }>('/auth/login', v);
      qc.setQueryData(meKey, res.user);
      navigate(from, { replace: true });
    } catch (e) { setError(errorMessage(e)); }
  });

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 [background:radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%)]" />
      <motion.div variants={stagger} initial="hidden" animate="show" className="relative w-full max-w-4xl">
        <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">
          <motion.div variants={item} className="space-y-5">
            <Logo />
            <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Command center for incidents and observability.</h1>
            <p className="max-w-md text-sm text-muted-foreground">Real-time telemetry, incident response, traces and dependency maps for engineering teams that need answers faster than their pager.</p>
            <SimulatedTag />
            <p className="text-xs text-subtle">Demo environment · all telemetry is deterministically simulated.</p>
          </motion.div>
          <motion.div variants={item} className="card p-6 shadow-card">
            <form onSubmit={submit} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!form.formState.errors.email} {...form.register('email')} />
                {form.formState.errors.email && <p role="alert" className="text-xs text-destructive">Enter a valid email</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
              </div>
              {error && <p role="alert" className="rounded-md bg-crit-soft px-3 py-2 text-sm text-crit">{error}</p>}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
            </form>
            <div className="mt-5 border-t border-border pt-4">
              <p className="eyebrow mb-2">Demo accounts · password <code className="font-mono normal-case">nexus-demo-2026</code></p>
              <ul className="space-y-1">
                {DEMO.map((d) => (
                  <li key={d.email}>
                    <button type="button" onClick={() => { form.setValue('email', d.email); form.setValue('password', 'nexus-demo-2026'); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60">
                      <span className="font-mono">{d.email}</span><span className="text-muted-foreground">{d.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

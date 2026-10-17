import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/features/auth/auth';
import { AppShell } from '@/app/AppShell';
const LoginPage = lazy(() => import('@/app/LoginPage'));

const page = <T extends { default: React.ComponentType }>(f: () => Promise<T>) => lazy(f);
const Overview = page(() => import('@/pages/Overview'));
const Incidents = page(() => import('@/pages/Incidents'));
const IncidentDetail = page(() => import('@/pages/IncidentDetail'));
const Services = page(() => import('@/pages/Services'));
const ServiceDetail = page(() => import('@/pages/ServiceDetail'));
const Metrics = page(() => import('@/pages/MetricsExplorer'));
const Traces = page(() => import('@/pages/Traces'));
const TraceDetail = page(() => import('@/pages/TraceDetail'));
const Events = page(() => import('@/pages/EventStream'));
const DependencyMap = page(() => import('@/pages/DependencyMap'));
const Deployments = page(() => import('@/pages/Deployments'));
const Alerts = page(() => import('@/pages/Alerts'));
const Team = page(() => import('@/pages/Team'));
const Audit = page(() => import('@/pages/Audit'));
const Settings = page(() => import('@/pages/Settings'));
const NotFound = page(() => import('@/pages/NotFound'));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Suspense fallback={null}><LoginPage /></Suspense>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="incidents" element={<Incidents />} />
        <Route path="incidents/:id" element={<IncidentDetail />} />
        <Route path="services" element={<Services />} />
        <Route path="services/:id" element={<ServiceDetail />} />
        <Route path="metrics" element={<Metrics />} />
        <Route path="traces" element={<Traces />} />
        <Route path="traces/:traceId" element={<TraceDetail />} />
        <Route path="events" element={<Events />} />
        <Route path="map" element={<DependencyMap />} />
        <Route path="deployments" element={<Deployments />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="team" element={<Team />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

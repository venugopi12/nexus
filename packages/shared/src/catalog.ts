/** Static service topology used by the seed script and the simulation model. */
export type ServiceKind = 'edge' | 'service' | 'database' | 'cache' | 'queue';

export interface ServiceProfile {
  key: string;
  name: string;
  kind: ServiceKind;
  team: string;
  tier: 1 | 2 | 3;
  baseRps: number;
  /** median latency in ms for a sampled request */
  baseLatencyMs: number;
  /** baseline error ratio in percent */
  baseErrorPct: number;
  dependsOn: string[];
  description: string;
}

export interface OrgCatalog {
  slug: string;
  name: string;
  services: ServiceProfile[];
}

const s = (p: ServiceProfile) => p;

export const ACME: OrgCatalog = {
  slug: 'acme',
  name: 'Acme Cloud',
  services: [
    s({ key: 'edge-gateway', name: 'Edge Gateway', kind: 'edge', team: 'Platform', tier: 1, baseRps: 1800, baseLatencyMs: 24, baseErrorPct: 0.15, dependsOn: ['auth-service', 'catalog-service', 'checkout-service', 'search-service', 'user-service'], description: 'Public ingress, TLS termination and request routing.' }),
    s({ key: 'auth-service', name: 'Auth Service', kind: 'service', team: 'Identity', tier: 1, baseRps: 640, baseLatencyMs: 38, baseErrorPct: 0.2, dependsOn: ['user-db', 'session-cache'], description: 'Token issuance, session validation and SSO.' }),
    s({ key: 'user-service', name: 'User Service', kind: 'service', team: 'Identity', tier: 2, baseRps: 420, baseLatencyMs: 46, baseErrorPct: 0.18, dependsOn: ['user-db', 'session-cache'], description: 'Profiles, preferences and account lifecycle.' }),
    s({ key: 'catalog-service', name: 'Catalog Service', kind: 'service', team: 'Commerce', tier: 2, baseRps: 900, baseLatencyMs: 52, baseErrorPct: 0.12, dependsOn: ['catalog-db', 'search-service', 'redis-cache'], description: 'Product catalog reads and pricing.' }),
    s({ key: 'search-service', name: 'Search Service', kind: 'service', team: 'Discovery', tier: 2, baseRps: 560, baseLatencyMs: 74, baseErrorPct: 0.25, dependsOn: ['redis-cache'], description: 'Full-text and faceted search.' }),
    s({ key: 'checkout-service', name: 'Checkout Service', kind: 'service', team: 'Commerce', tier: 1, baseRps: 260, baseLatencyMs: 118, baseErrorPct: 0.3, dependsOn: ['payments-service', 'inventory-service', 'order-service'], description: 'Cart validation and checkout orchestration.' }),
    s({ key: 'payments-service', name: 'Payments Service', kind: 'service', team: 'Payments', tier: 1, baseRps: 190, baseLatencyMs: 164, baseErrorPct: 0.22, dependsOn: ['payments-db', 'fraud-service'], description: 'Card authorisation and settlement.' }),
    s({ key: 'fraud-service', name: 'Fraud Service', kind: 'service', team: 'Payments', tier: 2, baseRps: 190, baseLatencyMs: 88, baseErrorPct: 0.1, dependsOn: ['redis-cache'], description: 'Real-time risk scoring.' }),
    s({ key: 'inventory-service', name: 'Inventory Service', kind: 'service', team: 'Commerce', tier: 2, baseRps: 330, baseLatencyMs: 41, baseErrorPct: 0.14, dependsOn: ['catalog-db', 'event-bus'], description: 'Stock levels and reservations.' }),
    s({ key: 'order-service', name: 'Order Service', kind: 'service', team: 'Commerce', tier: 1, baseRps: 240, baseLatencyMs: 69, baseErrorPct: 0.16, dependsOn: ['orders-db', 'event-bus'], description: 'Order persistence and state machine.' }),
    s({ key: 'notification-service', name: 'Notification Service', kind: 'service', team: 'Engagement', tier: 3, baseRps: 150, baseLatencyMs: 95, baseErrorPct: 0.4, dependsOn: ['event-bus'], description: 'Email, push and webhook delivery.' }),
    s({ key: 'user-db', name: 'Users DB', kind: 'database', team: 'Data', tier: 1, baseRps: 1200, baseLatencyMs: 6, baseErrorPct: 0.02, dependsOn: [], description: 'PostgreSQL primary for identity data.' }),
    s({ key: 'catalog-db', name: 'Catalog DB', kind: 'database', team: 'Data', tier: 2, baseRps: 1500, baseLatencyMs: 7, baseErrorPct: 0.02, dependsOn: [], description: 'PostgreSQL cluster for catalog and stock.' }),
    s({ key: 'orders-db', name: 'Orders DB', kind: 'database', team: 'Data', tier: 1, baseRps: 480, baseLatencyMs: 9, baseErrorPct: 0.02, dependsOn: [], description: 'PostgreSQL primary for orders.' }),
    s({ key: 'payments-db', name: 'Payments DB', kind: 'database', team: 'Data', tier: 1, baseRps: 380, baseLatencyMs: 8, baseErrorPct: 0.01, dependsOn: [], description: 'PostgreSQL primary for ledger data.' }),
    s({ key: 'redis-cache', name: 'Redis Cache', kind: 'cache', team: 'Platform', tier: 2, baseRps: 4200, baseLatencyMs: 1.2, baseErrorPct: 0.01, dependsOn: [], description: 'Shared low-latency cache cluster.' }),
    s({ key: 'session-cache', name: 'Session Cache', kind: 'cache', team: 'Identity', tier: 1, baseRps: 1800, baseLatencyMs: 1.1, baseErrorPct: 0.01, dependsOn: [], description: 'Session and token cache.' }),
    s({ key: 'event-bus', name: 'Event Bus', kind: 'queue', team: 'Platform', tier: 2, baseRps: 2200, baseLatencyMs: 4, baseErrorPct: 0.03, dependsOn: [], description: 'Kafka-compatible event backbone.' }),
  ],
};

export const GLOBEX: OrgCatalog = {
  slug: 'globex',
  name: 'Globex Systems',
  services: [
    s({ key: 'api-front', name: 'API Front', kind: 'edge', team: 'Core', tier: 1, baseRps: 700, baseLatencyMs: 30, baseErrorPct: 0.2, dependsOn: ['ledger-service', 'reports-service'], description: 'Public REST edge.' }),
    s({ key: 'ledger-service', name: 'Ledger Service', kind: 'service', team: 'Finance', tier: 1, baseRps: 310, baseLatencyMs: 80, baseErrorPct: 0.2, dependsOn: ['ledger-db', 'queue'], description: 'Double-entry ledger.' }),
    s({ key: 'reports-service', name: 'Reports Service', kind: 'service', team: 'Finance', tier: 3, baseRps: 60, baseLatencyMs: 320, baseErrorPct: 0.3, dependsOn: ['ledger-db'], description: 'Batch reporting.' }),
    s({ key: 'ledger-db', name: 'Ledger DB', kind: 'database', team: 'Data', tier: 1, baseRps: 500, baseLatencyMs: 8, baseErrorPct: 0.02, dependsOn: [], description: 'PostgreSQL ledger primary.' }),
    s({ key: 'queue', name: 'Job Queue', kind: 'queue', team: 'Core', tier: 2, baseRps: 800, baseLatencyMs: 5, baseErrorPct: 0.04, dependsOn: [], description: 'Background job broker.' }),
  ],
};

export const CATALOGS: OrgCatalog[] = [ACME, GLOBEX];
export const ENVIRONMENTS = ['production', 'staging'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

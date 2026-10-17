import { seed } from '../seed';

// The seed script truncates all tenant data before inserting, so a reset is simply a re-seed.
seed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

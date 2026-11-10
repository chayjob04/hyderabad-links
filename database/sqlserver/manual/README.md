# Scripts run by hand, never by DbUp

Everything in `database/sqlserver/migrations/` is applied automatically by `npm run db:migrate`.
The two scripts here are **not**, and must never be moved into that folder, because the whole point
of them is that a human decides when they run.

## `S0026_down.sql` — undo the customer identity split

Reverses `S0026__customer_identity.sql`: restores the original primary key and unique constraint
from `user_id`, and drops `customers`, `customer_sessions` and the new columns.

It works **only while S0027 has not run**, because it rebuilds the constraints from `user_id`, which
S0027 removes. That is the rollback window: after S0027, the only way back is a restore from
`npm run db:export`.

It refuses to run if any favourite or review was written by the new API (a row with `customer_id`
set and `user_id` NULL), because those rows have no `user_id` to rebuild a key from and dropping
them would be deleting somebody's data. If that happens, the honest options are to leave the split
in place and fix forward, or to restore from an export.

DbUp has journalled S0026 as applied. After running this script, delete that row by hand:

```sql
DELETE FROM dbo.SchemaVersions WHERE ScriptName LIKE '%S0026__customer_identity%';
```

## `S0027__customer_identity_finalise.sql` — close the split

Makes `favourites.customer_id` and `reviews.customer_id` NOT NULL, drops `user_id` from both, and
restores a plain primary key and unique constraint. Run it only once the new API has been live long
enough that no instance is still writing `user_id` — in practice, after a deployment has been
verified and you are confident you will not roll back.

Running it ends the rollback window. Take an export first:

```powershell
npm run db:export
```

Afterwards, journal it so a later `db:migrate` does not try to apply a copy of it:

```sql
INSERT INTO dbo.SchemaVersions (ScriptName, Applied)
VALUES ('Manual.S0027__customer_identity_finalise.sql', SYSDATETIMEOFFSET());
```

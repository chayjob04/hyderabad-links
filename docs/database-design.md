# Database Design — HYDERABAD LINKS

## 1. Database Platform

- **Local development:** an Azure SQL database (there is no local engine).
- **Production:** Azure SQL Database.
- **Database driver:** `Microsoft.Data.SqlClient`.
- **Data access:** Raw parameterized SQL. No ORM.
- **Migration tool:** DbUp.
- **Current migrations:** `database/sqlserver/migrations/`.
- **Historical migrations:** `database/migrations/` contains the former PostgreSQL implementation and must not be executed against SQL Server.

## 2. Design Principles

1. Use parameterized SQL for all database queries to prevent SQL injection.
2. Keep database access inside the API; frontend applications must not connect directly to the database.
3. Keep modules responsible for their own data access and business rules.
4. Use foreign keys, unique constraints, check constraints, and indexes where appropriate.
5. Use transactions when multiple database operations must succeed or fail together.
6. Store timestamps consistently in UTC.
7. Use forward-only SQL Server migrations for schema changes.
8. Never run migrations or destructive database commands against production without an explicit, reviewed deployment process.

## 3. Core Data Areas

The database supports these functional areas:

- **Identity and authentication:** Users, phone-based authentication, OTP verification, sessions, and administrative access.
- **Business listings:** Businesses, owners, categories, listing status, verification, and subscription plans.
- **Locations:** Hyderabad locations, localities, and location-based listing discovery.
- **Search:** Searchable business names, descriptions, categories, locations, and related search terms.
- **Media:** Business images and videos, with file metadata stored in the database and binary content stored in Azure Blob Storage.
- **Enquiries and leads:** Customer enquiries, business lead management, and related status tracking.
- **Reviews:** Customer reviews, moderation, and publication status.
- **Notifications:** Notification records and delivery status.
- **Billing:** Listing plans, subscriptions, payment records, and payment-provider references.
- **Administration:** Admin actions, moderation, audit records, and super-admin controls.

The authoritative table definitions and relationships are maintained in the current SQL Server migration files.

## 4. Search Design

Search must use capabilities supported by Microsoft SQL Server and Azure SQL Database.

- Use SQL Server full-text search where configured and supported.
- Use indexed, normalized columns for common filters and exact matches.
- Use a dedicated category-search-terms table where required by the current implementation.
- Use parameterized queries for search terms, filters, sorting, and pagination.
- Apply location, category, listing-status, and visibility filters before returning results.
- Review execution plans and indexes for frequently used search queries.

Do not assume PostgreSQL-specific extensions or operators are available in SQL Server.

## 5. Location Design

Store structured location information using the schema defined by the current SQL Server migrations.

Location filtering must use supported SQL Server types and queries. Any geographic-distance or proximity functionality must be implemented using SQL Server-compatible spatial capabilities if required by the application.

Do not assume PostGIS functions or types are available.

## 6. Media Storage

- Store image and video files in Azure Blob Storage.
- Store file metadata, ownership, listing relationships, content types, sizes, and storage references in SQL Server.
- Enforce media limits according to the listing plan.
- Validate uploads and authorize access on the server.
- Do not store large media binaries directly in relational database tables unless an explicit requirement justifies it.

## 7. Security and Data Integrity

- Use parameterized SQL for all values supplied to database queries.
- Enforce authorization in the API, not only in the frontend.
- Use database constraints to protect referential integrity.
- Keep credentials and connection strings in environment-specific secret storage.
- Do not log passwords, OTPs, authentication tokens, or sensitive connection details.
- Use least-privilege database identities.
- Separate development, staging, and production database configurations.
- Apply schema changes through reviewed migrations.

## 8. Migration Rules

1. Add new SQL Server migrations under `database/sqlserver/migrations/`.
2. Follow the existing migration naming convention.
3. Keep migrations forward-only; do not silently rewrite migrations already applied to a database.
4. Review each migration for data loss, locking, index impact, and compatibility.
5. Test migrations against a local SQL Server instance before deployment.
6. Keep PostgreSQL migrations under `database/migrations/` as historical records unless a separately approved archival change is made.
7. Never execute the historical PostgreSQL migrations against SQL Server.
8. Do not run destructive migrations against production without explicit approval and a verified recovery plan.

## 9. Source of Truth

The current SQL Server migration files define the authoritative database schema. If this document differs from the implemented schema, inspect the migrations and update this document to reflect the actual implementation rather than inventing tables or columns.

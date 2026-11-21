# Local development

## Prerequisites

1. Install Node.js **24.x**. The root `package.json` pins `engines.node` to `24.x`, which is also
   what the three CI workflows and all three Vercel projects build on, so a newer major is not
   "later", it is a different version from the one everything else uses.
2. Install the .NET SDK required by the project.
3. Install Git.
4. Have an Azure SQL database to point at. There is no local database engine and no Docker.

## Setup

1. Open a terminal at the repository root.
2. Install dependencies:

   ```powershell
   npm install

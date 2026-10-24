import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve('/tmp/sample-repo');
console.log('Target sample repo path:', target);

fs.mkdirSync(path.join(target, 'app', 'dashboard'), { recursive: true });
fs.mkdirSync(path.join(target, 'app', 'api', 'auth', '[...nextauth]'), { recursive: true });
fs.mkdirSync(path.join(target, 'app', 'api', 'billing'), { recursive: true });
fs.mkdirSync(path.join(target, 'tests'), { recursive: true });
fs.mkdirSync(path.join(target, 'prisma'), { recursive: true });

// 1. package.json with Next.js, Auth, Stripe dependencies
fs.writeFileSync(
  path.join(target, 'package.json'),
  JSON.stringify(
    {
      name: 'sample-next-app',
      version: '0.1.0',
      dependencies: {
        next: '^14.2.0',
        react: '^18.3.0',
        'next-auth': '^4.24.0',
        stripe: '^15.0.0',
      },
      scripts: {
        dev: 'next dev',
        test: 'node --test',
      },
    },
    null,
    2
  )
);

// 2. Working route: Dashboard
fs.writeFileSync(
  path.join(target, 'app', 'dashboard', 'page.tsx'),
  `export default function DashboardPage() {
  return <div>Welcome to Dashboard</div>;
}
`
);

// 3. Route with a TODO: Auth
fs.writeFileSync(
  path.join(target, 'app', 'api', 'auth', '[...nextauth]', 'route.ts'),
  `// TODO: configure Google and GitHub OAuth providers
export async function GET() {
  return Response.json({ status: "ok" });
}
`
);

// 4. Placeholder route: Billing returning 501
fs.writeFileSync(
  path.join(target, 'app', 'api', 'billing', 'route.ts'),
  `export async function POST() {
  return new Response("Not implemented", { status: 501 });
}
`
);

// 5. Test file targeting dashboard
fs.writeFileSync(
  path.join(target, 'tests', 'dashboard.test.js'),
  `test("dashboard loads correctly", () => {});
`
);

// 6. Prisma schema model
fs.writeFileSync(
  path.join(target, 'prisma', 'schema.prisma'),
  `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`
);

console.log('Sample repository successfully created at:', target);

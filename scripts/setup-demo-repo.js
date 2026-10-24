#!/usr/bin/env node

/**
 * Creates a realistic Next.js-style demo repository for testing project-memory.
 *
 * Features:
 * 1. Auth (next-auth) - implemented, with test file
 * 2. Dashboard - implemented page
 * 3. Gift-page editor - implemented page
 * 4. Image upload - incomplete (TODO + placeholder handler)
 * 5. Payments (stripe) - incomplete (returns 501)
 * 6. User profile - implemented
 * 7. Prisma schema with 3 models (User, Gift, Payment)
 *
 * Makes 8 git commits over several simulated days.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const demoDir = process.argv[2] || path.resolve(process.cwd(), 'demo-repo');

function run(args, cwd, env = {}) {
  execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}

function writeFile(relPath, content) {
  const fullPath = path.join(demoDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function commit(message, dateStr) {
  run(['add', '.'], demoDir, {
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_DATE: dateStr,
  });
  run(['commit', '-m', message, '--allow-empty'], demoDir, {
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_DATE: dateStr,
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────
console.log(`Creating demo repository at: ${demoDir}`);

if (fs.existsSync(demoDir)) {
  fs.rmSync(demoDir, { recursive: true, force: true });
}
fs.mkdirSync(demoDir, { recursive: true });

run(['init'], demoDir);
run(['config', 'user.email', 'demo@project-memory.dev'], demoDir);
run(['config', 'user.name', 'Demo Developer'], demoDir);

// ─── Commit 1: Initial project setup ────────────────────────────────────────
const day1 = '2025-10-18T09:00:00+00:00';

writeFile('package.json', JSON.stringify({
  name: 'giftly-app',
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    dev: 'next dev',
    build: 'next build',
    start: 'next start',
    lint: 'next lint',
    test: 'jest --passWithNoTests',
    'db:push': 'prisma db push',
    'db:generate': 'prisma generate',
  },
  dependencies: {
    next: '^14.2.0',
    react: '^18.3.0',
    'react-dom': '^18.3.0',
    'next-auth': '^4.24.5',
    '@prisma/client': '^5.10.0',
    stripe: '^14.14.0',
  },
  devDependencies: {
    typescript: '^5.4.0',
    prisma: '^5.10.0',
    tailwindcss: '^3.4.0',
    jest: '^29.7.0',
    '@types/react': '^18.2.0',
  },
}, null, 2));

writeFile('README.md', `# Giftly App

A modern gift-page creation platform where users can design beautiful personalized gift pages for special occasions.

## Getting Started

\`\`\`bash
npm install
npx prisma generate
npm run dev
\`\`\`

## Features

- 🎁 Create personalized gift pages
- 🔐 Secure authentication with NextAuth
- 💳 Payments via Stripe
- 📸 Image uploads for gift customization
- 📊 Dashboard to manage your gift pages
`);

writeFile('next.config.mjs', `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { domains: ['images.unsplash.com'] },
};
export default nextConfig;
`);

writeFile('tsconfig.json', JSON.stringify({
  compilerOptions: {
    target: 'es2017',
    lib: ['dom', 'es2017'],
    module: 'esnext',
    moduleResolution: 'bundler',
    jsx: 'preserve',
    strict: true,
    paths: { '@/*': ['./src/*'] },
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
}, null, 2));

writeFile('.env.example', `DATABASE_URL=postgresql://user:pass@localhost:5432/giftly
NEXTAUTH_SECRET=your-secret-here
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
S3_BUCKET=giftly-uploads
`);

writeFile('.env.local', `DATABASE_URL=postgresql://user:pass@localhost:5432/giftly
NEXTAUTH_SECRET=real-secret-should-not-be-scanned
`);

writeFile('.gitignore', `node_modules/
.next/
dist/
.env.local
.env
.project-memory/
`);

commit('Initial project setup with Next.js, Prisma, and Stripe', day1);

// ─── Commit 2: Prisma schema with 3 models ──────────────────────────────────
const day2 = '2025-10-18T14:30:00+00:00';

writeFile('prisma/schema.prisma', `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  name      String?
  email     String   @unique
  image     String?
  gifts     Gift[]
  payments  Payment[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Gift {
  id          String   @id @default(cuid())
  title       String
  description String?
  imageUrl    String?
  recipientName String
  recipientEmail String?
  isPublished Boolean  @default(false)
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  payments    Payment[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Payment {
  id            String   @id @default(cuid())
  amount        Int
  currency      String   @default("usd")
  status        String   @default("pending")
  stripePaymentId String? @unique
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  giftId        String
  gift          Gift     @relation(fields: [giftId], references: [id])
  createdAt     DateTime @default(now())
}
`);

commit('Add Prisma schema with User, Gift, and Payment models', day2);

// ─── Commit 3: Authentication ────────────────────────────────────────────────
const day3 = '2025-10-19T10:00:00+00:00';

writeFile('src/app/api/auth/[...nextauth]/route.ts', `import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

const handler = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
});

export { handler as GET, handler as POST };
`);

writeFile('src/app/auth/signin/page.tsx', `'use client';
import { signIn } from 'next-auth/react';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="rounded-lg border p-8 shadow-md">
        <h1 className="mb-6 text-2xl font-bold">Sign in to Giftly</h1>
        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="rounded bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
`);

writeFile('src/lib/prisma.ts', `import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma || new PrismaClient({ log: ['query'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
`);

commit('Implement authentication with NextAuth and Google provider', day3);

// ─── Commit 4: Dashboard and home page ───────────────────────────────────────
const day4 = '2025-10-19T15:00:00+00:00';

writeFile('src/app/page.tsx', `export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-6xl font-bold">🎁 Giftly</h1>
      <p className="mt-4 text-xl text-gray-600">
        Create beautiful personalized gift pages for any occasion
      </p>
      <a href="/auth/signin" className="mt-8 rounded bg-purple-600 px-8 py-4 text-white">
        Get Started
      </a>
    </main>
  );
}
`);

writeFile('src/app/dashboard/page.tsx', `import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) redirect('/auth/signin');

  const gifts = await prisma.gift.findMany({
    where: { userId: session.user?.email! },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold">Your Gift Pages</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {gifts.map((gift) => (
          <div key={gift.id} className="rounded-lg border p-4 shadow">
            <h3 className="text-lg font-semibold">{gift.title}</h3>
            <p className="text-sm text-gray-500">For {gift.recipientName}</p>
            <span className={gift.isPublished ? 'text-green-600' : 'text-yellow-600'}>
              {gift.isPublished ? 'Published' : 'Draft'}
            </span>
          </div>
        ))}
      </div>
      <a href="/gifts/new" className="mt-4 inline-block rounded bg-purple-600 px-6 py-3 text-white">
        Create New Gift Page
      </a>
    </div>
  );
}
`);

commit('Add home page and dashboard with gift listing', day4);

// ─── Commit 5: Gift page editor ─────────────────────────────────────────────
const day5 = '2025-10-20T09:00:00+00:00';

writeFile('src/app/gifts/new/page.tsx', `'use client';
import { useState } from 'react';

export default function NewGiftPage() {
  const [title, setTitle] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, recipientName: recipient, description }),
    });
    if (res.ok) window.location.href = '/dashboard';
  }

  return (
    <div className="container mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Create a Gift Page</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Gift title"
          className="w-full rounded border p-3"
          required
        />
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Recipient name"
          className="w-full rounded border p-3"
          required
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Write your message..."
          className="w-full rounded border p-3"
          rows={5}
        />
        <button type="submit" className="rounded bg-purple-600 px-6 py-3 text-white">
          Create Gift Page
        </button>
      </form>
    </div>
  );
}
`);

writeFile('src/app/api/gifts/route.ts', `import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gifts = await prisma.gift.findMany({
    where: { userId: session.user?.email! },
  });
  return NextResponse.json(gifts);
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const gift = await prisma.gift.create({
    data: {
      title: body.title,
      description: body.description,
      recipientName: body.recipientName,
      recipientEmail: body.recipientEmail,
      userId: session.user?.email!,
    },
  });
  return NextResponse.json(gift, { status: 201 });
}
`);

commit('Add gift page editor and API routes', day5);

// ─── Commit 6: Upload handler (INCOMPLETE - has TODO and placeholder) ────────
const day6 = '2025-10-20T14:00:00+00:00';

writeFile('src/app/api/upload/route.ts', `import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

// TODO: Implement S3 presigned URL generation for secure image uploads
// TODO: Add file size and type validation (max 5MB, images only)

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // HACK: This is a placeholder - the actual S3 integration is coming soon
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // coming soon: actual file upload to S3
  return NextResponse.json({
    message: 'not implemented - upload handler is a placeholder',
    url: '/placeholder-image.jpg',
  });
}
`);

writeFile('src/components/ImageUploader.tsx', `'use client';
import { useState } from 'react';

// TODO: Wire up to actual upload API endpoint once S3 is configured
export default function ImageUploader({ onUpload }: { onUpload: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    // FIXME: This currently does nothing useful since the API is not implemented
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      onUpload(data.url);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
      <input type="file" accept="image/*" onChange={handleFileChange} disabled={uploading} />
      {uploading && <p className="mt-2 text-sm text-gray-500">Uploading...</p>}
    </div>
  );
}
`);

commit('Add image upload stub with TODO markers', day6);

// ─── Commit 7: Payments endpoint (returns 501) ──────────────────────────────
const day7 = '2025-10-21T10:00:00+00:00';

writeFile('src/app/api/payments/route.ts', `import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  // Payment processing not implemented yet - returning 501
  return NextResponse.json(
    { error: 'Payment processing not implemented' },
    { status: 501 }
  );
}

export async function GET() {
  return NextResponse.json(
    { error: 'Payment listing not implemented' },
    { status: 501 }
  );
}
`);

writeFile('src/app/api/users/profile/route.ts', `import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email! },
  });
  return NextResponse.json(user);
}

export async function PUT(request: Request) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const user = await prisma.user.update({
    where: { email: session.user?.email! },
    data: { name: body.name, image: body.image },
  });
  return NextResponse.json(user);
}
`);

commit('Add payment stub (501) and user profile API', day7);

// ─── Commit 8: Auth test ─────────────────────────────────────────────────────
const day8 = '2025-10-21T16:00:00+00:00';

writeFile('tests/auth.test.ts', `import { describe, it, expect } from '@jest/globals';

describe('Authentication', () => {
  it('should reject unauthenticated requests', async () => {
    // Simulated test: auth routes should return 401 without session
    const mockResponse = { status: 401, body: { error: 'Unauthorized' } };
    expect(mockResponse.status).toBe(401);
  });

  it('should redirect to sign-in page', () => {
    const signInUrl = '/auth/signin';
    expect(signInUrl).toBe('/auth/signin');
  });

  it('should have Google as a configured provider', () => {
    const providers = ['google'];
    expect(providers).toContain('google');
  });
});
`);

commit('Add authentication test suite', day8);

console.log(`\n✓ Demo repository created successfully at: ${demoDir}`);
console.log(`  • 8 commits over 4 simulated days`);
console.log(`  • 7 features (auth, dashboard, gifts, upload, payments, users, home)`);
console.log(`  • 3 Prisma models (User, Gift, Payment)`);
console.log(`  • Upload feature has TODOs, FIXMEs, and placeholder code`);
console.log(`  • Payments endpoint returns 501 Not Implemented`);
console.log(`  • Auth has test file but no verified test run\n`);

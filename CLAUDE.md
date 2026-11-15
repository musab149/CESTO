# Grocery App Spain — Claude Code Project Context

## What you are building
A bilingual (Spanish/English) grocery delivery web and mobile app for Spain,
targeting South Asian expat communities and general shoppers. This is an MVP.

## Your two specification documents
Both documents are in /docs folder of this project:
- `docs/GroceryApp_Spain_MVP_Spec.docx` — all feature flows, API contracts,
  screen logic, data models, edge cases
- `docs/GroceryApp_Spain_DesignSystem.docx` — design tokens, component specs,
  Tailwind config, color palette, typography, animation rules

**Before building any screen or component, read the relevant section from
both documents. Do not build from memory.**

## Tech Stack (non-negotiable)
- Web: React (Vite) + TypeScript + Tailwind CSS + React Query + Zustand
- Mobile: React Native (Expo) + TypeScript + NativeWind + React Query + Zustand
- Backend: Node.js + Express + TypeScript + PostgreSQL + Redis
- Auth: JWT (access 15min) + refresh tokens (30 days) + OTP via SMS
- Push: Firebase Cloud Messaging
- Maps: Google Maps Platform
- Storage: Bunny.net Edge Storage + pull zone w/ Optimizer (product images)
- ORM: Prisma

## Project Structure
/apps
  /web          → React web app (customer-facing)
  /mobile       → React Native Expo app
  /admin        → React web app (admin panel)
/packages
  /api          → Express backend
  /shared       → shared types, constants, utils

## Design Rules (non-negotiable, memorize these)
1. Page background: NEVER white. Always bg-surface-linen (#F5F0E8)
2. Text: NEVER black (#000). Always ink (#1A1A1A) for primary text
3. Font: Outfit for ALL UI (buttons, labels, nav, headings, prices)
       Manrope for body text and descriptions only
       JetBrains Mono for order numbers, SKUs, postcodes only
4. All CTA buttons: rounded-xl (12px), min-height 52px, brand green
5. All cards: rounded-lg (8px), shadow-card, bg-surface-cream
6. Product add button: morphs to quantity stepper on first tap
7. Icons: Lucide React only, strokeWidth={1.75}
8. All user-facing strings: Spanish by default
9. Loading states: always shimmer skeletons, never blank screens
10. Empty states: always illustration + text + CTA, never just "No data"

## Build Order (UPDATED — Frontend First)

### Current Strategy: Clickable Prototype
Build all frontend UIs with static mock data first. No API calls.
Backend integration happens in Phase 3 after frontend is reviewed and signed off.

Phase 1: ✅ DB Schema + Seed (DONE — parked, resume later)
Phase 2: Mock Data Layer (shared fake data that all frontends consume)
Phase 3: Customer Web App — full UI, all screens, clickable
Phase 4: Admin Panel — full UI, all screens, clickable  
Phase 5: Mobile App — full UI, all screens, clickable
Phase 6: Backend API endpoints (resume from where Phase 1 stopped)
Phase 7: Replace mock data with real API calls across all frontends

## Mock Data Rules
- All mock data lives in /packages/mock-data
- Never hardcode data inline in components — always import from mock-data
- Mock data shapes must exactly match the Prisma schema field names
  so replacing with real API responses requires zero component changes
- Use React Query with a custom mock fetcher so swapping to real 
  API calls later is a single-line change per query

## When you're unsure about a flow or a component
Re-read the relevant section in the spec documents before asking me.
The answer is almost always in there.
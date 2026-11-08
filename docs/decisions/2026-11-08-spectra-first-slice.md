# 2026-11-08 — XENO Spectra: the first slice, in Corpo › Analytics

**Status:** proposed, for the owner. `xeno-spectra/SPEC.md` is a draft "awaiting lock" (v0.1, 2026-07-12), so what
Spectra is stays the owner's call. This record asks one narrower question: what is the first thing to build.

## Context

Corpo › Analytics in the workspace is a sample area ("Revenue €42k", "Support 7 open"). Everything those tiles would
show already exists as real platform data: the CRM pipeline (`crm_deals`), support tickets and their SLAs, form
responses, bookings, invoices, the credit ledger and agent runs. The draft spec's v1 horizon is far larger:
connectors to any database, a semantic layer, DuckDB, twelve chart types, NL-to-query, alerts, embedding.

## How the leaders start

**Metabase** started as "ask a question of your own database" with a handful of charts. **Looker** started with the
semantic layer (LookML). **HubSpot / Stripe** dashboards start from the product's own data, fixed reports first,
custom ones second. **Power BI** started as Excel's data model online.

## Options

1. **First-party dashboards first.** A workspace's own data (pipeline, support, forms, bookings, invoices, spend), as
   metrics defined once on the server (the semantic-layer idea, small), a few charts (stat tile, line, bar, table),
   a dashboard per workspace people can arrange, and agents reading the same metrics through MCP. No external
   connectors yet.
2. **Bring-your-own database first** (Metabase's start): connectors, a query editor, charts. Bigger security surface
   (credentials, egress, row limits) before anyone has a dashboard of their own business.
3. **Wait for the spec to lock.**

## Recommendation

**Option 1.** It replaces sample data with real data in a page that exists, needs no new data store (metrics are
queries over existing tables, each scoped to the workspace like the services that own them), and it is the honest
foundation for the semantic layer the draft spec asks for. External connectors come after the spec locks.

## Blast radius

Read-only queries over existing tables; a `spectra_dashboards` table for layouts (additive). No writes to any other
product's data. Agents get read-only `spectra.*` tools.

## Rollback

Turn the area back into "Coming soon". No other product changes.

## What would make us revisit

The spec locking with a different first audience (for example, Spectra as a standalone BI product for external
databases first).

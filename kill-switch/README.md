# Billing kill-switch — setup runbook (console, no CLI)

Automatically **disables billing** on the project when spend crosses a low
threshold, so an unattended period (you away 2 weeks, no internet) can never
produce a large bill. Caps EVERYTHING, including dynamic Street View (which has
no per-day quota knob on the web JS API).

Two facts to accept before you start:
- **It is not instant.** A budget trigger reacts in *hours*. That is fine while
  you are away — what matters is the guaranteed ceiling, not the reaction speed.
- **When it fires, the game goes down** until you manually re-enable billing.
  Since you are away, the game simply stays down for the rest of the trip. That
  is the price of the guarantee.

Do everything in the Google Cloud Console for the project that runs this game.

> **What actually worked (June 2026, deployed via the console code editor).**
> The "Write a function" path described below was not the one used in practice —
> the code was pasted into the Cloud Run inline **Source** editor instead. That
> path does NOT auto-wire the entry point, so two things had to be added by hand
> and are now required:
> 1. A `start` script in `package.json` (already present in this folder):
>    `functions-framework --target=killBilling --signature-type=cloudevent`.
> 2. An environment variable **`FUNCTION_TARGET` = `killBilling`** on the service.
>    Without it the container kept the sample default `helloPubSub`, failed to find
>    that function, and never listened on port 8080 (the "container failed to start
>    on PORT=8080" error). Set it via **Edit & deploy new revision → Variables &
>    Secrets**, alongside `GCP_PROJECT_ID`.
>
> The budget created was named **`kill-switch-velo`**. The Eventarc trigger and the
> runtime service account (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`)
> were created automatically by the Pub/Sub trigger. Everything below was verified
> end-to-end, including a real billing cut-off (see step 5).

---

## 0. Enable the required APIs

Console → **APIs & Services → Enable APIs & services**, enable:
- **Cloud Billing API**
- **Cloud Functions API** (and **Cloud Run** + **Cloud Build**, pulled in automatically)
- **Cloud Pub/Sub API**

---

## 1. Create the Pub/Sub topic

Console → **Pub/Sub → Topics → Create topic**.
- Topic ID: `billing-kill-switch`
- Leave defaults, Create.

---

## 2. Create the Cloud Function

> Note: Google merged Cloud Functions into **Cloud Run** (2025). There is no
> longer a "2nd gen" choice — everything is the new model by default.

Console → **Cloud Run** → click **Write a function** (top, next to "Deploy
container").
- **Service name**: `billing-kill-switch`
- **Region**: any (e.g. `europe-west1`)
- **Runtime**: **Node.js 20**
- **Function entry point**: `killBilling`
- Language: **Node.js** (version 22 or 20).
- **Trigger** section → **Add trigger** → **Pub/Sub trigger** → in the Eventarc
  pane select topic `billing-kill-switch` (keep the default trigger name).
  The console will ask to enable the Eventarc API and grant roles — accept.
- **Authentication**: **Require authentication** (NEVER "Allow unauthenticated"
  — this function disables billing, it must not be publicly callable; the
  Pub/Sub/Eventarc trigger invokes it via an authenticated service account).

The new Cloud Run form shows many extra sections. For this use case:
- **Billing**: **Request-based** (pay only when it runs).
- **Service scaling**: **Minimum instances = 0** (no idle cost). Max = default.
- **Ingress**: **All / Allow all traffic** (safe here because Require
  authentication is on; "Internal" can break Eventarc delivery).
- **Containers / Networking / Security**: leave all defaults.
- **Environment variables** — under **Containers → Variables & Secrets → Add
  variable**: `GCP_PROJECT_ID` = *your project ID* (shown in the console
  header). Can also be added after creation via "Edit & deploy new revision".

Click **Create**. The inline **code editor** opens on the NEXT screen — replace
the sample files with the two from this folder, then **Save and redeploy**:
  - `index.js`
  - `package.json`

After deploy, open the service → note its **runtime service account**
(looks like `PROJECT_NUMBER-compute@developer.gserviceaccount.com`, or a
dedicated one if you created it). You need it in step 3.

---

## 3. Let the function disable billing (the sensitive permission)

The function can only detach billing if its service account is a **Billing
Account Administrator** on the billing account.

Console → **Billing → (your billing account) → Account management →
Permissions** (or **Billing → IAM**).
- Add principal: the function's **runtime service account** from step 2.
- Role: **Billing Account Administrator** (`roles/billing.admin`).
- Save.

---

## 4. Create the budget that triggers it (recommended)

Console → **Billing → Budgets & alerts → Create budget**.
- Name: **`kill-switch-velo`** (just a label).
- Time range: **Monthly** (default — matches Google's monthly free tier).
- Scope: this project only (`velo-versailles-geogg`). Leave **Services = all** and
  the savings/credits checkboxes at their defaults — narrowing them would leave a gap.
- Amount: **Specified amount → 2 EUR** (well above 0 but far below anything
  scary; normal play stays in the free tier at 0 EUR, so it never fires).
- Thresholds: leave the defaults (50% / 90% / 100%).
- **Manage notifications → Connect a Pub/Sub topic to this budget** → select
  `billing-kill-switch`.
- Finish.

The function ignores the 50% / 90% messages and only detaches billing once
actual cost ≥ the budget amount (see `index.js`).

> Free tier reminder: 10 000 map loads + 5 000 dynamic Street View **per month**
> are free. A game ≈ 2 map loads + ~5 Street View, so ~1 000 games/month before
> a single cent. A 2 EUR budget only fires well past that — i.e. only on real abuse.

---

## 4-bis. Alternative trigger: Monitoring (reacts in minutes)

Only if you want minutes instead of hours (not needed while away). Same topic,
same function.

1. Console → **Monitoring → Alerting → Edit notification channels → Pub/Sub →
   Add** → topic `billing-kill-switch`. (Grant the Monitoring service agent
   Publisher on the topic if prompted.)
2. **Monitoring → Alerting → Create policy**:
   - Metric: **Consumed API → Request count**
     (`serviceruntime.googleapis.com/api/request_count`), filtered to the Maps
     service.
   - Condition: rolling rate **above** a threshold clearly past normal play
     (tune after watching real usage).
   - Notifications: the Pub/Sub channel from step 1.
   - Save.

Note: validate that your real Street View usage actually shows up in this metric
before relying on it — that is the fiddly part of this path, and why the budget
trigger is the safer default for an unattended period.

---

## 5. Test it safely (do this BEFORE you leave)

No code change needed. The function only detaches billing when
`costAmount >= budgetAmount`, so a **below-budget** message exercises the whole
chain (topic → Eventarc trigger → function loads → parses → decides) with **zero
risk** — it logs and returns without touching billing.

1. **Pub/Sub → topic `billing-kill-switch` → Messages → Publish message**, body:
   ```json
   {"costAmount": 1, "budgetAmount": 2, "currencyCode": "EUR"}
   ```
2. **Cloud Run → service → Logs**: confirm a `POST 204` then
   `Cost 1 < budget 2; no action.` — the pipeline works and nothing was cut.

Then, the real end-to-end test (this DOES disable billing):

3. Publish again with `{"costAmount": 999, "budgetAmount": 2, "currencyCode": "EUR"}`.
4. Logs must show `✅ Billing DISABLED for projects/...`. A red permission error
   here means the step-3 role didn't apply — fix it before leaving.
5. **Re-enable billing manually** (see "When you get back") to bring the game back.

Verified June 2026: both messages behaved exactly as above, and the real budget
`kill-switch-velo` was also seen publishing its own `costAmount: 0` notification
to the topic — confirming the budget→topic link independently of the manual tests.

---

## When you get back

If the kill-switch fired while you were away, re-enable billing:
Console → **Billing → (project) → Link a billing account**. The game works again.

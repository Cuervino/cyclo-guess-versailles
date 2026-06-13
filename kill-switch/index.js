// Cloud Function (2nd gen) — Billing kill-switch.
//
// Triggered by a Pub/Sub message coming from EITHER:
//   (A) a Cloud Billing budget notification (recommended), or
//   (B) a Cloud Monitoring alert notification channel.
//
// When invoked, it detaches the billing account from the project, which
// stops ALL billable usage (Maps JS, dynamic Street View included).
//
// The project this protects is identified by the GCP_PROJECT_ID env var,
// set at deploy time (see README.md).

const functions = require("@google-cloud/functions-framework");
const { CloudBillingClient } = require("@google-cloud/billing");

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const PROJECT_NAME = `projects/${PROJECT_ID}`;
const billing = new CloudBillingClient();

functions.cloudEvent("killBilling", async (cloudEvent) => {
  if (!PROJECT_ID) {
    console.error("GCP_PROJECT_ID env var is not set; aborting.");
    return;
  }

  const raw = cloudEvent?.data?.message?.data;
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(Buffer.from(raw, "base64").toString());
      console.log("Notification payload:", JSON.stringify(payload));
    } catch (e) {
      console.log("Could not parse Pub/Sub payload; will act anyway.", e);
    }
  }

  // If this is a BUDGET notification, only act once spend has actually
  // reached the budget. Budget alerts also fire at 50%/90% — we must NOT
  // cut at those. A Monitoring notification has no costAmount, so we fall
  // through and act (the alert policy itself is the condition).
  if (payload && typeof payload.costAmount === "number") {
    if (payload.costAmount < payload.budgetAmount) {
      console.log(
        `Cost ${payload.costAmount} < budget ${payload.budgetAmount}; no action.`
      );
      return;
    }
  }

  const enabled = await isBillingEnabled();
  if (!enabled) {
    console.log("Billing already disabled; nothing to do.");
    return;
  }
  await disableBilling();
});

async function isBillingEnabled() {
  try {
    const [info] = await billing.getProjectBillingInfo({ name: PROJECT_NAME });
    return Boolean(info.billingEnabled);
  } catch (e) {
    console.error("Failed to read billing info:", e);
    // If we can't tell, do nothing rather than risk a wrong action.
    return false;
  }
}

async function disableBilling() {
  await billing.updateProjectBillingInfo({
    name: PROJECT_NAME,
    projectBillingInfo: { billingAccountName: "" }, // empty string = detach
  });
  console.log(`✅ Billing DISABLED for ${PROJECT_NAME}`);
}

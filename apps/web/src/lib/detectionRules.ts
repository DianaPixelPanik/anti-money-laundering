import type { Transaction, Alert, RiskSeverity, Recommendation } from "@/types/aml";

const HIGH_RISK_COUNTRIES = ["KP", "IR", "SY", "CU", "VE", "MM", "SD"];

function scoreToSeverity(score: number): RiskSeverity {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function scoreToRecommendation(score: number): Recommendation {
  if (score >= 80) return "FILE_SAR";
  if (score >= 55) return "ESCALATE";
  return "MONITOR";
}

let alertIdCounter = 1;
function makeId(): string {
  return `LOCAL-${String(alertIdCounter++).padStart(6, "0")}`;
}

/**
 * Rule 1: UNUSUAL_VELOCITY
 * More than 5 transactions from the same account within a 24-hour window.
 */
function detectUnusualVelocity(transactions: Transaction[]): Alert[] {
  const alerts: Alert[] = [];
  const byAccount = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const arr = byAccount.get(tx.from_account) ?? [];
    arr.push(tx);
    byAccount.set(tx.from_account, arr);
  }

  for (const [account, txs] of Array.from(byAccount.entries())) {
    const sorted = [...txs].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Sliding 24-hour window
    for (let i = 0; i < sorted.length; i++) {
      const windowStart = new Date(sorted[i].date).getTime();
      const windowEnd = windowStart + 24 * 60 * 60 * 1000;
      const inWindow = sorted.filter(
        (t) => {
          const ts = new Date(t.date).getTime();
          return ts >= windowStart && ts <= windowEnd;
        }
      );

      if (inWindow.length > 5) {
        const totalAmount = inWindow.reduce((s, t) => s + t.amount, 0);
        const riskScore = Math.min(95, 60 + inWindow.length * 3);
        alerts.push({
          id: makeId(),
          transactionId: sorted[i].tx_id,
          transaction: sorted[i],
          riskScore,
          severity: scoreToSeverity(riskScore),
          pattern: "UNUSUAL_VELOCITY",
          explanation: JSON.stringify({
            summary: `Account ${account} sent ${inWindow.length} transactions within a 24-hour period totalling ${totalAmount.toLocaleString()}.`,
            red_flags: [
              `${inWindow.length} outgoing transactions from a single account in 24 hours`,
              `Total value: ${totalAmount.toLocaleString()} across rapid transfers`,
              `Velocity pattern is consistent with account layering or rapid fund movement`,
            ],
            pattern_explanation:
              "Unusual velocity refers to an abnormally high number of transactions originating from one account in a short time window. This pattern is frequently associated with layering — the second stage of money laundering — where funds are moved rapidly through multiple accounts to obscure their origin.",
            recommendation_reason:
              "The transaction frequency significantly exceeds normal customer behaviour thresholds. Escalation for manual review is warranted to determine whether this constitutes a reportable suspicious activity.",
          }),
          evidence: [
            `${inWindow.length} transactions in 24h from ${account}`,
            `Total value: ${totalAmount.toLocaleString()}`,
            `Window: ${sorted[i].date}`,
          ],
          ruleId: "RULE-VELOCITY-001",
          recommendedAction:
            "Review account history for the past 30 days. Determine if velocity is consistent with known customer profile. Consider freezing account pending investigation.",
          recommendation: scoreToRecommendation(riskScore),
          status: "PENDING",
          createdAt: new Date().toISOString(),
        });
        break; // one alert per account
      }
    }
  }

  return alerts;
}

/**
 * Rule 2: LARGE_AMOUNT
 * Any single transaction with amount >= 100,000.
 */
function detectLargeAmount(transactions: Transaction[]): Alert[] {
  return transactions
    .filter((tx) => tx.amount >= 100_000)
    .map((tx) => {
      const riskScore = Math.min(95, 65 + Math.floor((tx.amount - 100_000) / 50_000) * 5);
      return {
        id: makeId(),
        transactionId: tx.tx_id,
        transaction: tx,
        riskScore,
        severity: scoreToSeverity(riskScore),
        pattern: "LARGE_AMOUNT" as const,
        explanation: JSON.stringify({
          summary: `Transaction ${tx.tx_id} involves a large single transfer of ${tx.amount.toLocaleString()} ${tx.currency ?? ""}`.trim() + ".",
          red_flags: [
            `Transaction amount of ${tx.amount.toLocaleString()} exceeds the large-transaction reporting threshold`,
            `Single-transaction transfer from ${tx.from_account} to ${tx.to_account}`,
            tx.country ? `Transaction involved jurisdiction: ${tx.country}` : "No country code recorded",
          ],
          pattern_explanation:
            "Large single transactions above the regulatory threshold of €100,000 require mandatory review under AMLD5 and equivalent frameworks. Such transfers may represent placement — the first stage of laundering — where large sums of illicit cash are introduced into the financial system.",
          recommendation_reason:
            "The transaction value exceeds the automatic review threshold. Verification of the underlying commercial purpose and source of funds documentation must be obtained before processing.",
        }),
        evidence: [
          `Amount: ${tx.amount.toLocaleString()} ${tx.currency ?? ""}`,
          `From: ${tx.from_account}`,
          `To: ${tx.to_account}`,
          `Date: ${tx.date}`,
        ],
        ruleId: "RULE-LARGE-002",
        recommendedAction:
          "Obtain source of funds documentation. Verify business justification. Escalate to compliance officer if documentation is insufficient.",
        recommendation: scoreToRecommendation(riskScore),
        status: "PENDING" as const,
        createdAt: new Date().toISOString(),
      };
    });
}

/**
 * Rule 3: SMURFING
 * Transactions in the 8,500–9,999 band — just below the €10,000 reporting threshold.
 */
function detectSmurfing(transactions: Transaction[]): Alert[] {
  return transactions
    .filter((tx) => tx.amount >= 8_500 && tx.amount <= 9_999)
    .map((tx) => {
      const riskScore = 78;
      return {
        id: makeId(),
        transactionId: tx.tx_id,
        transaction: tx,
        riskScore,
        severity: scoreToSeverity(riskScore),
        pattern: "SMURFING" as const,
        explanation: JSON.stringify({
          summary: `Transaction ${tx.tx_id} for ${tx.amount.toLocaleString()} falls in the structuring band (€8,500–€9,999), just below the mandatory reporting threshold.`,
          red_flags: [
            `Amount ${tx.amount.toLocaleString()} is within the known structuring band (€8,500–€9,999)`,
            "Transaction designed to stay below the €10,000 automatic reporting threshold",
            "Pattern is consistent with smurfing — deliberate sub-threshold structuring",
          ],
          pattern_explanation:
            "Smurfing (also called structuring) involves breaking large sums into smaller transactions specifically to avoid currency transaction reporting requirements. The €8,500–€9,999 band is the most common range used by launderers attempting to evade the €10,000 mandatory reporting threshold.",
          recommendation_reason:
            "The transaction amount falls within the highest-probability structuring band. Even a single such transaction warrants investigation when combined with other indicators. Multiple such transactions from the same account are a near-certain indicator of deliberate evasion.",
        }),
        evidence: [
          `Amount ${tx.amount.toLocaleString()} in structuring band €8,500–€9,999`,
          `From: ${tx.from_account}`,
          `To: ${tx.to_account}`,
          `Date: ${tx.date}`,
        ],
        ruleId: "RULE-SMURFING-003",
        recommendedAction:
          "Check whether the same sender has made multiple sub-threshold transactions. If three or more sub-threshold transactions from the same account exist, file a SAR immediately.",
        recommendation: scoreToRecommendation(riskScore),
        status: "PENDING" as const,
        createdAt: new Date().toISOString(),
      };
    });
}

/**
 * Rule 4: CROSS_BORDER_RISK
 * Transactions involving sanctioned or high-risk jurisdictions.
 */
function detectCrossBorderRisk(transactions: Transaction[]): Alert[] {
  return transactions
    .filter((tx) => tx.country && HIGH_RISK_COUNTRIES.includes(tx.country.toUpperCase()))
    .map((tx) => {
      const riskScore = 90;
      return {
        id: makeId(),
        transactionId: tx.tx_id,
        transaction: tx,
        riskScore,
        severity: scoreToSeverity(riskScore),
        pattern: "CROSS_BORDER_RISK" as const,
        explanation: JSON.stringify({
          summary: `Transaction ${tx.tx_id} involves jurisdiction ${tx.country}, which is subject to international sanctions and FATF blacklisting.`,
          red_flags: [
            `Country code ${tx.country} is on the OFAC/UN sanctions list`,
            `Any financial exposure to ${tx.country} requires mandatory compliance review`,
            `Transaction value: ${tx.amount.toLocaleString()} — potential sanctions breach`,
          ],
          pattern_explanation:
            `Transactions involving ${tx.country} are subject to comprehensive sanctions regimes. Processing or facilitating transactions with sanctioned jurisdictions can expose the institution to severe regulatory penalties, criminal prosecution, and reputational damage.`,
          recommendation_reason:
            "Sanctioned jurisdiction involvement is an automatic escalation trigger. The transaction must be frozen immediately pending compliance review. A SAR must be filed if any doubt exists as to the legitimacy of the transaction.",
        }),
        evidence: [
          `Sanctioned jurisdiction: ${tx.country}`,
          `Amount: ${tx.amount.toLocaleString()} ${tx.currency ?? ""}`,
          `From: ${tx.from_account} → To: ${tx.to_account}`,
          `Date: ${tx.date}`,
        ],
        ruleId: "RULE-CROSSBORDER-004",
        recommendedAction:
          "Freeze transaction immediately. Escalate to compliance officer and legal team. File SAR with FIU within 30 days. Conduct enhanced due diligence on all parties.",
        recommendation: "FILE_SAR" as const,
        status: "PENDING" as const,
        createdAt: new Date().toISOString(),
      };
    });
}

/**
 * Rule 5: UNKNOWN_COUNTERPARTY
 * Accounts that appear only once in the entire dataset (as sender or receiver).
 * Indicates unknown or one-off counterparties — common in shell company networks.
 */
function detectUnknownCounterparty(transactions: Transaction[]): Alert[] {
  const accountCounts = new Map<string, number>();

  for (const tx of transactions) {
    accountCounts.set(tx.from_account, (accountCounts.get(tx.from_account) ?? 0) + 1);
    accountCounts.set(tx.to_account, (accountCounts.get(tx.to_account) ?? 0) + 1);
  }

  const alerts: Alert[] = [];
  const seen = new Set<string>();

  for (const tx of transactions) {
    for (const account of [tx.to_account]) {
      if ((accountCounts.get(account) ?? 0) === 1 && !seen.has(tx.tx_id + account)) {
        seen.add(tx.tx_id + account);
        const riskScore = 52;
        alerts.push({
          id: makeId(),
          transactionId: tx.tx_id,
          transaction: tx,
          riskScore,
          severity: scoreToSeverity(riskScore),
          pattern: "UNKNOWN_COUNTERPARTY" as const,
          explanation: JSON.stringify({
            summary: `Account ${account} appears only once in this dataset as a recipient, suggesting it may be an unverified or one-time counterparty.`,
            red_flags: [
              `Account ${account} has only one transaction in the dataset`,
              "Single-appearance accounts are frequently associated with shell companies or mule accounts",
              "No transaction history available to establish normal behaviour baseline",
            ],
            pattern_explanation:
              "Unknown counterparties — accounts that appear only once in a transaction dataset — are a common indicator of shell company usage or money mule activity. Legitimate business relationships typically show recurring transaction patterns between established counterparties.",
            recommendation_reason:
              "The lack of transaction history for this counterparty makes it impossible to assess normal behaviour. Enhanced due diligence should be conducted to verify the identity and business purpose of the receiving account.",
          }),
          evidence: [
            `Account ${account} appears only once in dataset`,
            `As recipient in TX: ${tx.tx_id}`,
            `Amount received: ${tx.amount.toLocaleString()} ${tx.currency ?? ""}`,
          ],
          ruleId: "RULE-COUNTERPARTY-005",
          recommendedAction:
            "Conduct KYC verification on the counterparty account. Verify ownership, business registration, and stated purpose of funds. Flag for enhanced monitoring.",
          recommendation: scoreToRecommendation(riskScore),
          status: "PENDING" as const,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return alerts;
}

/**
 * Run all detection rules against the given transactions.
 * Returns a deduplicated array of alerts sorted by riskScore descending.
 */
export function runDetectionRules(transactions: Transaction[]): Alert[] {
  alertIdCounter = 1;

  const allAlerts = [
    ...detectUnusualVelocity(transactions),
    ...detectLargeAmount(transactions),
    ...detectSmurfing(transactions),
    ...detectCrossBorderRisk(transactions),
    ...detectUnknownCounterparty(transactions),
  ];

  // Deduplicate by transactionId + pattern (keep highest risk score)
  const dedupMap = new Map<string, Alert>();
  for (const alert of allAlerts) {
    const key = `${alert.transactionId}:${alert.pattern}`;
    const existing = dedupMap.get(key);
    if (!existing || alert.riskScore > existing.riskScore) {
      dedupMap.set(key, alert);
    }
  }

  return Array.from(dedupMap.values()).sort((a, b) => b.riskScore - a.riskScore);
}

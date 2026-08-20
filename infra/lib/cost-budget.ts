/**
 * AWS Budgets alarm - full-audit round1/round2 (Arquitetura, Cost & Resource Governance).
 * Both Claude and Codex round-1/round-2 reviews flagged the same concrete, correctable-
 * without-AWS-deploy gap: no budget/cost alarm exists anywhere in the stack, despite
 * reservedConcurrentExecutions/on-demand DynamoDB/long-polling being good STRUCTURAL cost
 * choices - none of them catch a runaway cost event (e.g. a poison-message retry storm, or
 * a misconfigured schedule) after the fact. `AWS::Budgets::Budget` is an account/billing
 * resource (not scoped to this stack's own resources), synthesizable and testable via CDK
 * assertions without a real deploy, same as every other construct in `infra/lib`.
 *
 * Threshold is a judgment call proportional to this stage (no production traffic yet, Stage
 * 0-2 per implementation-blueprint.md) - a low fixed monthly ceiling meant to catch runaway
 * cost early, not to model real unit economics (that is the still-unformalized FinOps axis,
 * per joint-review-criteria.md's "Como adicionar um novo eixo" section). Revisit once real
 * traffic/cost data exists.
 */
import * as budgets from "aws-cdk-lib/aws-budgets";
import { Construct } from "constructs";

export interface CostBudgetProps {
  /** Monthly USD ceiling before the alarm fires. Default: 50 (dev/pre-production ceiling). */
  monthlyLimitUsd?: number;
  /** Email(s) notified at 80% forecasted and 100% actual spend. Optional: if omitted, the
   * budget still synthesizes (visible in Billing console) but has no active subscriber -
   * documented gap, not silently dropped, until a notification owner is decided. */
  notificationEmails?: string[];
}

export class CostBudget extends Construct {
  constructor(scope: Construct, id: string, props: CostBudgetProps = {}) {
    super(scope, id);

    const limit = props.monthlyLimitUsd ?? 50;
    const subscribers: budgets.CfnBudget.SubscriberProperty[] =
      (props.notificationEmails ?? []).map((address) => ({
        subscriptionType: "EMAIL",
        address,
      }));

    const notificationsWithSubscribers: budgets.CfnBudget.NotificationWithSubscribersProperty[] =
      subscribers.length > 0
        ? [
            {
              notification: {
                notificationType: "FORECASTED",
                comparisonOperator: "GREATER_THAN",
                threshold: 80,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
            {
              notification: {
                notificationType: "ACTUAL",
                comparisonOperator: "GREATER_THAN",
                threshold: 100,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
          ]
        : [];

    new budgets.CfnBudget(this, "MonthlyCostBudget", {
      budget: {
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: limit, unit: "USD" },
      },
      notificationsWithSubscribers:
        notificationsWithSubscribers.length > 0 ? notificationsWithSubscribers : undefined,
    });
  }
}

# Root provider wiring — ADR-0009 step 2. Backend intentionally left unconfigured (local
# state) for this stage of the migration; remote state (S3 + use_lockfile, following the
# sibling event-discovery-platform/infrastructure/terraform pattern) is deferred to the
# GitHub Actions/OIDC pipeline follow-up, out of scope for this session per the task brief.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  # Local dev: AWS_PROFILE=claude-dev (plan-only, per the repo's hard rule against apply).
  # CI: credentials injected via OIDC once the pipeline follow-up lands (out of scope here).

  default_tags {
    tags = {
      Project     = local.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

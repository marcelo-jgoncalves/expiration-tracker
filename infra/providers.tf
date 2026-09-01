# Root provider wiring — ADR-0009. Remote state via S3 native locking (use_lockfile,
# Terraform >=1.10, same pattern as the sibling event-discovery-platform/infrastructure/
# terraform), bucket bootstrapped once via AWS CLI (not Terraform — chicken-and-egg: the
# bucket must exist before this backend block can initialize against it).
# Backend config values are passed via -backend-config on `terraform init` (see
# backend.hcl.example and .github/workflows/{ci,cd}.yml), never hardcoded here, so the
# same config works for local dev (AWS_PROFILE=claude-dev, plan-only) and CI (OIDC).

terraform {
  required_version = ">= 1.10" # use_lockfile (S3 native locking) requires >= 1.10
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.19"
    }
    # M10 (D-037): gera o pepper de hash do guest token (random_password) - nunca hardcoded
    # em código nem em texto claro versionado. Trade-off consciente registrado (achado de
    # revisão adversarial): valor vai direto como env var Lambda (criptografado em repouso
    # pelo Lambda, nunca logado/commitado), não via Secrets Manager fetch em runtime -
    # proporcional ao estágio atual (sem dado real de tenant em risco ainda). Upgrade para
    # Secrets Manager real fica registrado como follow-up, não decidido/implementado agora.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {}
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

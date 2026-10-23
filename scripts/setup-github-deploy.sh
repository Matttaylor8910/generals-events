#!/usr/bin/env bash
# Create (or repair) the service account that GitHub Actions uses to run
# `firebase deploy`, and store its key as the FIREBASE_DEPLOY_SA_KEY secret on
# this repository. Safe to re-run: existing accounts and roles are kept, a new
# key is minted each time and the previous one is NOT deleted (do that in the
# console if you are rotating).
#
# Requires: gcloud (logged in as a project owner) and gh (logged in with repo
# admin access). The key only ever lives in a temp file that is shredded at
# the end; it never touches the repository.
set -euo pipefail

PROJECT=generals-tournaments
SA_NAME=github-deploy
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SECRET_NAME=FIREBASE_DEPLOY_SA_KEY

# Roles needed by `firebase deploy` for hosting, rules, indexes and 1st gen
# functions that read Secret Manager secrets. cloudscheduler.admin is for the
# scheduled functions (updateSeasonEvent, getEventStars) and
# artifactregistry.repoAdmin lets the CLI clean up function build images.
ROLES=(
  roles/firebase.admin
  roles/iam.serviceAccountUser
  roles/secretmanager.viewer
  roles/serviceusage.serviceUsageConsumer
  roles/cloudscheduler.admin
  roles/artifactregistry.repoAdmin
)

echo ">>> service account"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name="GitHub Actions: firebase deploy"
fi

# a freshly created account takes a few seconds to become visible to IAM
echo ">>> waiting for the service account to propagate"
for attempt in $(seq 1 12); do
  if gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

echo ">>> roles"
for ROLE in "${ROLES[@]}"; do
  for attempt in $(seq 1 6); do
    if gcloud projects add-iam-policy-binding "$PROJECT" \
        --member="serviceAccount:${SA}" --role="$ROLE" --condition=None --format=none 2>/tmp/iam-err; then
      break
    fi
    if [ "$attempt" -eq 6 ]; then
      cat /tmp/iam-err >&2
      exit 1
    fi
    echo "    $ROLE not applied yet, retrying in 10s"
    sleep 10
  done
done

echo ">>> key -> GitHub secret ${SECRET_NAME} on ${REPO}"
KEY_FILE=$(mktemp)
trap 'rm -f "$KEY_FILE"' EXIT
gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA" --project "$PROJECT"
gh secret set "$SECRET_NAME" --repo "$REPO" < "$KEY_FILE"

# the old workflow used a secret with this name, it is no longer read
gh secret delete GOOGLE_APPLICATION_CREDENTIALS --repo "$REPO" 2>/dev/null || true

echo ">>> done. Push to master (or re-run the latest workflow) to deploy."

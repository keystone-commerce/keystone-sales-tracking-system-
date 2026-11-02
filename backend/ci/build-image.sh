#!/usr/bin/env bash
set -euo pipefail
: "${ECR_REPOSITORY_URI:?Set the Sales Ops ECR repository URI}"
: "${AWS_DEFAULT_REGION:?Set the AWS region}"
[[ "$ECR_REPOSITORY_URI" =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9._/-]+$ ]] || { echo "Invalid ECR repository URI" >&2; exit 2; }
registry="${ECR_REPOSITORY_URI%%/*}"
repository="${ECR_REPOSITORY_URI#*/}"
[[ "$registry" == *".${AWS_DEFAULT_REGION}.amazonaws.com" ]] || { echo "ECR region mismatch" >&2; exit 2; }
# Unique tags make a rerun a new release instead of overwriting a previous image.
tag="${RELEASE_TAG:-release-${CODEBUILD_BUILD_ID##*:}}"
[[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ && "$tag" != latest ]] || { echo "Set a unique release tag" >&2; exit 2; }
mutability="$(aws ecr describe-repositories --repository-names "$repository" --query 'repositories[0].imageTagMutability' --output text)"
[[ "$mutability" == IMMUTABLE ]] || { echo "This pipeline requires immutable ECR tags" >&2; exit 2; }
npm --prefix backend test
image="${ECR_REPOSITORY_URI}:${tag}"
aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin "$registry"
docker build --pull --platform linux/amd64 --file backend/Dockerfile --tag "$image" backend
docker push "$image"
digest="$(aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$tag" --query 'imageDetails[0].imageDigest' --output text)"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Cannot determine release digest" >&2; exit 1; }
mkdir -p .release
RELEASE_IMAGE="$image" RELEASE_DIGEST="$digest" node --input-type=module -e 'import {writeFileSync} from "node:fs";writeFileSync(".release/image.json",JSON.stringify({image:process.env.RELEASE_IMAGE,digest:process.env.RELEASE_DIGEST},null,2));'

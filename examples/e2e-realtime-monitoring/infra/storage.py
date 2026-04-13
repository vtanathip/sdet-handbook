"""
storage.py
----------
Provisions the S3 bucket used to store pre-built application artifacts
(ZIP archives) that the EC2 instance downloads during bootstrap.

Usage:
    from storage import create_artifact_bucket
    bucket = create_artifact_bucket(tags)
"""

import pulumi
import pulumi_aws as aws


def create_artifact_bucket(tags: dict[str, str]) -> aws.s3.BucketV2:
    """Create an S3 bucket for deployment artifacts."""

    bucket = aws.s3.BucketV2(
        "artifact-bucket",
        force_destroy=True,  # Ephemeral perf-test artifacts; safe to destroy
        tags={**tags, "Name": "perf-test-artifacts"},
    )

    # Block all public access — EC2 reaches the bucket via IAM role
    aws.s3.BucketPublicAccessBlock(
        "artifact-bucket-public-access-block",
        bucket=bucket.id,
        block_public_acls=True,
        block_public_policy=True,
        ignore_public_acls=True,
        restrict_public_buckets=True,
    )

    return bucket

"""
iam.py
------
Provisions the IAM resources that allow the EC2 instance to download
deployment artifacts from the S3 bucket without embedding AWS credentials.

Resources:
  - IAM Role  (EC2 assume-role trust policy)
  - IAM Policy (s3:GetObject + s3:ListBucket on the artifacts bucket)
  - IAM Instance Profile (attached to the EC2 instance)

Usage:
    from iam import create_instance_profile
    profile = create_instance_profile(bucket_arn, tags)
"""

import json

import pulumi
import pulumi_aws as aws


def create_instance_profile(
    bucket_arn: pulumi.Input[str],
    tags: dict[str, str],
) -> aws.iam.InstanceProfile:
    """
    Create an IAM Instance Profile that grants the EC2 host read-only
    access to the artifacts S3 bucket.
    """

    role = aws.iam.Role(
        "app-host-role",
        assume_role_policy=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"Service": "ec2.amazonaws.com"},
                        "Action": "sts:AssumeRole",
                    }
                ],
            }
        ),
        tags={**tags, "Name": "perf-test-app-host-role"},
    )

    # Least-privilege: only GetObject + ListBucket on the artifacts bucket
    aws.iam.RolePolicy(
        "app-host-s3-read-policy",
        role=role.name,
        policy=pulumi.Output.from_input(bucket_arn).apply(
            lambda arn: json.dumps(
                {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Action": ["s3:GetObject"],
                            "Resource": f"{arn}/*",
                        },
                        {
                            "Effect": "Allow",
                            "Action": ["s3:ListBucket"],
                            "Resource": arn,
                        },
                    ],
                }
            )
        ),
    )

    profile = aws.iam.InstanceProfile(
        "app-host-instance-profile",
        role=role.name,
        tags={**tags, "Name": "perf-test-app-host-profile"},
    )

    return profile

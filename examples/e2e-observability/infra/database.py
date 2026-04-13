"""
database.py
-----------
Provisions the RDS PostgreSQL instance and its supporting resources:

  - Security Group (allows TCP 5432 from the EC2 security group only)
  - DB Subnet Group (spans the two private subnets in different AZs)
  - RDS Instance  (PostgreSQL 15, db.t3.medium, single-AZ, encrypted,
                   not publicly accessible)

The RDS password is passed as a Pulumi Output[str] so it is kept as a
Pulumi secret and never materialised as plain text.

Usage:
    from database import create_database
    db = create_database(network, ec2_sg_id, rds_password, common_tags)
    # db["rds"].address  — hostname consumed by userdata
"""

from typing import TypedDict

import pulumi
import pulumi_aws as aws


class DatabaseOutputs(TypedDict):
    rds: aws.rds.Instance
    rds_sg: aws.ec2.SecurityGroup


def create_database(
    network: dict,
    ec2_sg_id: pulumi.Output,
    rds_password: pulumi.Output,
    tags: dict[str, str],
) -> DatabaseOutputs:
    """Create RDS security group, subnet group, and PostgreSQL instance."""

    vpc_id = network["vpc"].id

    # ── RDS Security Group ─────────────────────────────────────────────────
    # Restrict inbound PostgreSQL to the EC2 security group only; no public
    # access is allowed at the network layer.
    rds_sg = aws.ec2.SecurityGroup(
        "rds-sg",
        vpc_id=vpc_id,
        description="Allow TCP 5432 from the EC2 host only",
        ingress=[
            aws.ec2.SecurityGroupIngressArgs(
                description="PostgreSQL from EC2 host",
                protocol="tcp",
                from_port=5432,
                to_port=5432,
                security_groups=[ec2_sg_id],
            )
        ],
        egress=[
            aws.ec2.SecurityGroupEgressArgs(
                description="Allow all outbound",
                protocol="-1",
                from_port=0,
                to_port=0,
                cidr_blocks=["0.0.0.0/0"],
            )
        ],
        tags={**tags, "Name": "perf-test-rds-sg"},
    )

    # ── DB Subnet Group ────────────────────────────────────────────────────
    # AWS requires at least two subnets in different AZs, even for single-AZ.
    subnet_group = aws.rds.SubnetGroup(
        "rds-subnet-group",
        subnet_ids=[
            network["db_subnet_a"].id,
            network["db_subnet_b"].id,
        ],
        description="Private subnets for perf-test RDS instance",
        tags={**tags, "Name": "perf-test-rds-subnet-group"},
    )

    # ── RDS Instance ───────────────────────────────────────────────────────
    rds = aws.rds.Instance(
        "rds",
        engine="postgres",
        engine_version="15",
        instance_class="db.t3.medium",
        allocated_storage=20,
        storage_type="gp3",
        storage_encrypted=True,
        db_name="todos",
        username="todos",
        password=rds_password,
        db_subnet_group_name=subnet_group.name,
        vpc_security_group_ids=[rds_sg.id],
        multi_az=False,
        publicly_accessible=False,
        skip_final_snapshot=True,
        deletion_protection=False,
        tags={**tags, "Name": "perf-test-rds"},
        opts=pulumi.ResourceOptions(ignore_changes=["password"]),
    )

    return DatabaseOutputs(rds=rds, rds_sg=rds_sg)

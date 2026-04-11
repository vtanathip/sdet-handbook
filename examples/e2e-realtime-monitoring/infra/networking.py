"""
networking.py
-------------
Provisions all VPC-layer resources for the performance-testing environment:

  - VPC (10.0.0.0/16)
  - Public Subnet (10.0.1.0/24)
  - Internet Gateway + Route Table (0.0.0.0/0 → IGW) + Association
  - Security Group
      Inbound  TCP 443  from VPC CIDR  — internal Datadog HTTPS traffic
      Inbound  TCP 8126 from VPC CIDR  — Datadog Trace Agent (internal)
      Inbound  TCP 3389 from 0.0.0.0/0 — RDP management (restrict in production)
      Outbound all traffic             — Datadog cloud intake + MSI download

A random 6-char suffix is appended to logical resource names to prevent
naming collisions across repeated stack deployments.

Usage:
    from networking import create_network
    net = create_network(common_tags)
    # net["vpc"], net["subnet"], net["security_group"]
"""

from typing import TypedDict

import pulumi
import pulumi_aws as aws
import pulumi_random as random

_VPC_CIDR = "10.0.0.0/16"
_SUBNET_CIDR = "10.0.1.0/24"


class NetworkOutputs(TypedDict):
    vpc: aws.ec2.Vpc
    subnet: aws.ec2.Subnet
    security_group: aws.ec2.SecurityGroup


def create_network(tags: dict[str, str]) -> NetworkOutputs:
    """Create and wire up all networking resources; return key handles."""

    # ── Unique suffix to avoid name clashes ───────────────────────────────
    suffix = random.RandomString(
        "net-suffix",
        length=6,
        special=False,
        upper=False,
        numeric=True,
    )
    name = lambda base: pulumi.Output.concat(base, "-", suffix.result)

    # ── VPC ───────────────────────────────────────────────────────────────
    vpc = aws.ec2.Vpc(
        "vpc",
        cidr_block=_VPC_CIDR,
        enable_dns_support=True,
        enable_dns_hostnames=True,
        tags={**tags, "Name": "perf-test-vpc"},
    )

    # ── Public Subnet ─────────────────────────────────────────────────────
    subnet = aws.ec2.Subnet(
        "public-subnet",
        vpc_id=vpc.id,
        cidr_block=_SUBNET_CIDR,
        map_public_ip_on_launch=True,
        tags={**tags, "Name": "perf-test-public-subnet"},
    )

    # ── Internet Gateway ──────────────────────────────────────────────────
    igw = aws.ec2.InternetGateway(
        "igw",
        vpc_id=vpc.id,
        tags={**tags, "Name": "perf-test-igw"},
    )

    # ── Route Table (default route → IGW) ────────────────────────────────
    route_table = aws.ec2.RouteTable(
        "route-table",
        vpc_id=vpc.id,
        routes=[
            aws.ec2.RouteTableRouteArgs(
                cidr_block="0.0.0.0/0",
                gateway_id=igw.id,
            )
        ],
        tags={**tags, "Name": "perf-test-rt"},
    )

    aws.ec2.RouteTableAssociation(
        "rt-assoc",
        subnet_id=subnet.id,
        route_table_id=route_table.id,
    )

    # ── Security Group ─────────────────────────────────────────────────────
    sg = aws.ec2.SecurityGroup(
        "sg",
        vpc_id=vpc.id,
        description=(
            "Perf-test host: Datadog internal (443, 8126) + RDP management (3389)"
        ),
        ingress=[
            # Datadog HTTPS — internal VPC only
            aws.ec2.SecurityGroupIngressArgs(
                description="Datadog HTTPS internal",
                protocol="tcp",
                from_port=443,
                to_port=443,
                cidr_blocks=[_VPC_CIDR],
            ),
            # Datadog Trace Agent — internal VPC only
            aws.ec2.SecurityGroupIngressArgs(
                description="Datadog Trace Agent internal",
                protocol="tcp",
                from_port=8126,
                to_port=8126,
                cidr_blocks=[_VPC_CIDR],
            ),
            # RDP — management access (tighten to known IP in production)
            aws.ec2.SecurityGroupIngressArgs(
                description="RDP management",
                protocol="tcp",
                from_port=3389,
                to_port=3389,
                cidr_blocks=["0.0.0.0/0"],
            ),
        ],
        egress=[
            # Unrestricted outbound — required for Datadog cloud intake + MSI download
            aws.ec2.SecurityGroupEgressArgs(
                description="Allow all outbound",
                protocol="-1",
                from_port=0,
                to_port=0,
                cidr_blocks=["0.0.0.0/0"],
            )
        ],
        tags={**tags, "Name": "perf-test-sg"},
    )

    return NetworkOutputs(vpc=vpc, subnet=subnet, security_group=sg)

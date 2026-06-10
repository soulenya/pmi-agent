"""Catalog of FDA / ISO regulatory document templates.

Each template describes a well-known regulatory deliverable: its governing
standards, a default section structure, and guidance the LLM uses when
drafting content. The catalog is intentionally static — templates are
curated, not user-editable.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RegTemplate:
    """A regulatory document template definition."""

    key: str
    label: str
    category: str  # "FDA" | "ISO / EU"
    description: str
    related_standards: tuple[str, ...]
    default_sections: tuple[str, ...]
    guidance: str
    recommended_format: str = "docx"  # "docx" | "md"


REG_TEMPLATES: tuple[RegTemplate, ...] = (
    # ── FDA ──────────────────────────────────────────────────────────────────
    RegTemplate(
        key="fda_510k",
        label="510(k) Premarket Notification Outline",
        category="FDA",
        description=(
            "Traditional 510(k) submission outline demonstrating substantial "
            "equivalence to a legally marketed predicate device."
        ),
        related_standards=("21 CFR 807 Subpart E", "FDA Guidance: Format of Traditional and Abbreviated 510(k)s"),
        default_sections=(
            "Administrative Information",
            "Indications for Use Statement",
            "510(k) Summary",
            "Truthful and Accuracy Statement",
            "Device Description",
            "Substantial Equivalence Discussion (Predicate Comparison)",
            "Proposed Labeling",
            "Sterilization and Shelf Life",
            "Biocompatibility",
            "Software Documentation",
            "Electromagnetic Compatibility and Electrical Safety",
            "Performance Testing — Bench",
            "Performance Testing — Animal and Clinical (if applicable)",
        ),
        guidance=(
            "Follow the FDA eSTAR / Traditional 510(k) content structure. For each "
            "section, state what evidence belongs there and reference the predicate "
            "comparison approach. Include a predicate comparison table placeholder."
        ),
    ),
    RegTemplate(
        key="fda_design_control",
        label="Design and Development Plan",
        category="FDA",
        description=(
            "Design control plan covering the full design lifecycle per "
            "21 CFR 820.30 and ISO 13485 §7.3."
        ),
        related_standards=("21 CFR 820.30", "ISO 13485:2016 §7.3"),
        default_sections=(
            "Purpose",
            "Scope",
            "References",
            "Definitions",
            "Responsibilities",
            "Design and Development Stages",
            "Design Inputs",
            "Design Outputs",
            "Design Reviews",
            "Design Verification",
            "Design Validation",
            "Design Transfer",
            "Design Changes",
            "Design History File",
        ),
        guidance=(
            "Write as a controlled procedure. Define stage gates, deliverables per "
            "stage, and review/approval requirements. Map each section to the "
            "corresponding 21 CFR 820.30 clause."
        ),
    ),
    RegTemplate(
        key="fda_capa_sop",
        label="CAPA Procedure",
        category="FDA",
        description=(
            "Corrective and Preventive Action procedure: initiation, investigation, "
            "action, and effectiveness verification."
        ),
        related_standards=("21 CFR 820.100", "ISO 13485:2016 §8.5"),
        default_sections=(
            "Purpose",
            "Scope",
            "References",
            "Definitions",
            "Responsibilities",
            "CAPA Sources and Initiation",
            "Risk-Based Prioritization",
            "Root Cause Investigation",
            "Corrective Action",
            "Preventive Action",
            "Effectiveness Verification",
            "CAPA Closure",
            "Records",
            "Management Reporting",
        ),
        guidance=(
            "Write as a controlled SOP with numbered procedure steps. Include "
            "root-cause methods (5 Whys, fishbone), risk-based prioritization "
            "criteria, and objective effectiveness checks before closure."
        ),
    ),
    RegTemplate(
        key="fda_complaint",
        label="Complaint Handling Procedure",
        category="FDA",
        description=(
            "Procedure for receiving, evaluating, investigating, and trending "
            "customer complaints, including MDR reportability assessment."
        ),
        related_standards=("21 CFR 820.198", "21 CFR 803", "ISO 13485:2016 §8.2.2"),
        default_sections=(
            "Purpose",
            "Scope",
            "Definitions",
            "Responsibilities",
            "Complaint Intake and Logging",
            "Initial Review and Evaluation",
            "Investigation",
            "MDR Reportability Assessment",
            "Complaint Closure",
            "Trending and Reporting",
            "Records",
        ),
        guidance=(
            "Write as a controlled SOP. Include decision criteria for when an "
            "investigation is required, the MDR reportability decision flow per "
            "21 CFR 803, and links to the CAPA process for systemic issues."
        ),
    ),
    RegTemplate(
        key="fda_dhf_index",
        label="Design History File Index",
        category="FDA",
        description=(
            "Index document cataloguing the contents and location of all design "
            "history file records for a device."
        ),
        related_standards=("21 CFR 820.30(j)",),
        default_sections=(
            "Device Identification",
            "Design Plan References",
            "Design Inputs Index",
            "Design Outputs Index",
            "Design Review Records",
            "Design Verification Records",
            "Design Validation Records",
            "Design Transfer Records",
            "Design Change Records",
        ),
        guidance=(
            "Produce an index with a table per section: document number, title, "
            "revision, date, and storage location columns. Keep prose minimal."
        ),
    ),
    # ── ISO / EU ────────────────────────────────────────────────────────────
    RegTemplate(
        key="iso_quality_manual",
        label="Quality Manual",
        category="ISO / EU",
        description=(
            "Top-level quality manual describing the QMS scope, processes, and "
            "their interactions per ISO 13485."
        ),
        related_standards=("ISO 13485:2016 §4.2.2",),
        default_sections=(
            "Introduction and Company Profile",
            "Scope of the QMS and Non-Applications",
            "Normative References",
            "Terms and Definitions",
            "Quality Management System",
            "Management Responsibility",
            "Resource Management",
            "Product Realization",
            "Measurement, Analysis and Improvement",
            "QMS Process Map and Interactions",
            "Document Structure",
        ),
        guidance=(
            "Mirror the ISO 13485:2016 clause structure (clauses 4–8). Justify any "
            "non-applications (e.g. sterile devices, installation). Describe the "
            "documented-information hierarchy (manual → procedures → work "
            "instructions → records)."
        ),
    ),
    RegTemplate(
        key="iso_rmp",
        label="Risk Management Plan",
        category="ISO / EU",
        description=(
            "Plan defining the risk management activities, responsibilities, and "
            "acceptability criteria for a device per ISO 14971."
        ),
        related_standards=("ISO 14971:2019 §4.4",),
        default_sections=(
            "Purpose and Scope",
            "Device Description and Intended Use",
            "Risk Management Responsibilities and Authorities",
            "Risk Management Process Overview",
            "Criteria for Risk Acceptability",
            "Risk Analysis Methods",
            "Risk Evaluation",
            "Risk Control",
            "Evaluation of Overall Residual Risk",
            "Risk Management Review",
            "Production and Post-Production Activities",
            "Risk Management File",
        ),
        guidance=(
            "Define a 5×5 probability/severity matrix with explicit acceptability "
            "zones (acceptable / ALARP / unacceptable). Name analysis methods "
            "(PHA, FMEA) and when each is applied across the lifecycle."
        ),
    ),
    RegTemplate(
        key="iso_rmr",
        label="Risk Management Report",
        category="ISO / EU",
        description=(
            "Report summarizing risk management results and concluding on overall "
            "residual risk acceptability per ISO 14971."
        ),
        related_standards=("ISO 14971:2019 §9",),
        default_sections=(
            "Purpose",
            "Device and Scope",
            "Summary of Risk Management Activities",
            "Risk Analysis Summary",
            "Risk Evaluation Summary",
            "Risk Control Measures and Verification",
            "Overall Residual Risk Evaluation",
            "Conclusions on Risk Acceptability",
            "Production and Post-Production Surveillance Plan Reference",
            "Approvals",
        ),
        guidance=(
            "Reference the Risk Management Plan and conclude explicitly whether "
            "the overall residual risk is acceptable against the plan's criteria. "
            "Include a summary table placeholder of top residual risks."
        ),
    ),
    RegTemplate(
        key="iso_sop",
        label="Standard Operating Procedure (Generic)",
        category="ISO / EU",
        description=(
            "General-purpose controlled SOP shell for any quality system process."
        ),
        related_standards=("ISO 13485:2016 §4.2.4",),
        default_sections=(
            "Purpose",
            "Scope",
            "References",
            "Definitions and Abbreviations",
            "Responsibilities",
            "Procedure",
            "Records",
            "Revision History",
            "Approvals",
        ),
        guidance=(
            "Write the Procedure section as clear numbered steps with role "
            "callouts. Include a revision-history table and an approvals block "
            "(prepared by / reviewed by / approved by)."
        ),
    ),
    RegTemplate(
        key="iso_doc",
        label="Declaration of Conformity",
        category="ISO / EU",
        description=(
            "EU Declaration of Conformity for a medical device under MDR 2017/745."
        ),
        related_standards=("EU MDR 2017/745 Annex IV", "ISO/IEC 17050-1"),
        default_sections=(
            "Manufacturer Information",
            "Device Identification (Basic UDI-DI)",
            "Product Description and Intended Purpose",
            "Classification and Rule Applied",
            "Conformity Assessment Procedure",
            "Notified Body (if applicable)",
            "Applied Standards and Common Specifications",
            "Declaration Statement",
            "Place, Date and Signature",
        ),
        guidance=(
            "Keep it to one or two pages in formal declarative language. The "
            "Declaration Statement must state sole responsibility of the "
            "manufacturer per MDR Article 19."
        ),
        recommended_format="docx",
    ),
)

TEMPLATE_KEYS: frozenset[str] = frozenset(t.key for t in REG_TEMPLATES)
_BY_KEY: dict[str, RegTemplate] = {t.key: t for t in REG_TEMPLATES}


def get_template(key: str) -> RegTemplate | None:
    """Return the template for *key*, or None if unknown."""
    return _BY_KEY.get(key)

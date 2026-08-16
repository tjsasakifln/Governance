<!-- AUTHORITY: PERSONAL_PORTFOLIO -->
> **AUTHORITY / AUTORIDADE — read this first.**
>
> This repository is a **personal portfolio and legacy draft** of Tiago Sasaki.
> It is **not** CONFENGE operational governance, **not** a CONFENGE source of truth, and **not** the Extra Consultoria / `extra-cli` operating system.
> Repositório de **portfólio pessoal / legado**. **Não** é a governança operacional canônica da CONFENGE e **não** é source of truth de nenhum sistema CONFENGE.
>
> Extra Consultoria development policy already lives in [`tjsasakifln/extra-cli`](https://github.com/tjsasakifln/extra-cli) (`DOD.md`, `docs/DEVELOPMENT.md`). This repo does not override it.
> The three protocol files below are reusable **personal samples**. They are not live CONFENGE runbooks.
<!-- /AUTHORITY -->

# 🏗️ Tiago Sasaki — Domain-Native AI Engineer & High-Velocity Architect

> **Civil Engineer turned Software Architect.** > Bridging the gap between complex industry constraints (GovTech/ConTech/Supply Chain) and scalable, rigorous software systems.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-blue)](https://www.linkedin.com/in/tiagosasaki/)
[![GitHub followers](https://img.shields.io/github/followers/tjsasakifln?style=social)](https://github.com/tjsasakifln)

---

## 🎯 Executive Summary

I am a **Product Engineer** with a background in Civil Engineering and Public Infrastructure. I don't just write code; I build **compliant systems** for highly regulated industries.

Unlike traditional developers who focus solely on syntax, I bring **structural rigor** to software architecture. I leverage LLMs and Agentic Workflows not to replace engineering, but to achieve **10x velocity on boilerplate**, allowing me to focus on what matters: **race conditions, transactional integrity, and business logic.**

**My Core Value Proposition:**
* **Autonomy:** Solo-shipped a production-grade GovTech SaaS (ETP Express) with **760+ features in 90 days**.
* **Governance:** I don't rely on "hero mode". I rely on automated engineering protocols that enforce quality standards before code ever hits `master`.
* **Domain Expertise:** I understand that in sectors like Supply Chain and Construction, "moving fast" cannot mean breaking things.

---

## 🛠️ Personal engineering-protocol samples

These are **portfolio drafts**, not an operating CONFENGE control plane. To keep high velocity without accruing technical debt I drafted a suite of reusable review/backlog protocols. They are samples of how I work; they are not CONFENGE policy.

### 1. [The "Zero-Tolerance" Automated Reviewer](./review-pr.md)
* **What it is:** A deterministic PR auditing system.
* **Function:** Enforces a **100/100 score** across 8 categories (Security, OWASP, Testing, Docs) before a human ever reviews the code.
* **Impact:** Eliminates bikeshedding on formatting/style, allowing human review to focus purely on architecture and logic. Includes automatic rollback layers for post-merge failures.

### 2. [Deterministic Task Prioritization](./pick-next-issue.md)
* **What it is:** An algorithmic decision matrix for backlog management.
* **Function:** Removes decision fatigue by selecting the next task based on ROI, Critical Path (P0>P1), and Dependency Blocking.
* **Impact:** Ensures I am always working on the highest-value feature, preventing "cherry-picking" of easy tasks over necessary ones.

### 3. [Drift Detection Audit](./audit-roadmap.md)
* **What it is:** A synchronization engine between Documentation (Roadmap) and Reality (Git State).
* **Function:** Automatically detects "Phantom Issues" (documented but not coded) and "Orphan Code" (coded but not documented).
* **Impact:** Guarantees that the project Roadmap is always a source of truth, crucial for stakeholder transparency in complex supply chains.

---

## ⚡ Technical Stack (The "Heavy Lifting")

I build robust, scalable systems using industry-standard tools for enterprise environments.

### **Backend & Architecture**
* **Core:** TypeScript, Node.js, **NestJS** (Strict Typing & Modular Architecture)
* **Async Processing:** **BullMQ**, Redis (For complex job queues and reliable message brokering)
* **Persistence:** PostgreSQL (Focus on complex schema design and transactional integrity)
* **Infrastructure:** Docker, Railway, GitHub Actions (CI/CD)

### **AI & Agentic Orchestration**
* **Frameworks:** LangChain, Vercel AI SDK
* **Techniques:** RAG (Retrieval-Augmented Generation) for regulatory compliance, Structured Output parsing.
* **Philosophy:** AI as a deterministic function caller, not a probabilistic chatter.

---

## 🚀 Featured Project: ETP Express (GovTech)

**The Challenge:** Brazilian public procurement is a bureaucracy-heavy process governed by strict laws (Law 14.133/2021), typically requiring 40+ hours of manual documentation per bid.

**The Solution:** A monolithic SaaS platform that automates the generation of compliant technical documents.

* **Architecture:** React Frontend + NestJS Backend.
* **Key Feature:** An Agentic Workflow that ingests raw project data and "drafts" legal documents, which are then validated by a deterministic rule engine.
* **Result:** Reduced documentation time from **40 hours to <2 hours** per bid.
* **Scale:** 760+ features shipped solo in 3 months using the governance protocols listed above.

---

## 🌍 The Vision: "Domain-Native" Engineering

> *"The most valuable engineer in 2026 is not the one who knows the most algorithms, but the one who understands the friction of the physical world."*

I am positioning myself at the intersection of **Software Engineering** and **Industrial Reality** (Supply Chain, Construction, Government).

I am looking to join a high-performance team where I can apply my **velocity, discipline, and domain empathy** to solve real-world problems.

---

## ☎️ Let's Connect

**Open to Senior Backend / Full-Stack opportunities (Remote / International).**

<div align="center">
  
[![Email](https://img.shields.io/badge/Email-Contact-red)](mailto:tiago.sasaki@confenge.com.br)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-blue)](https://www.linkedin.com/in/tiagosasaki/)

</div>

---

<div align="center">
  
**Keywords**: `TypeScript` • `NestJS` • `System Architecture` • `CI/CD` • `GovTech` • `ConTech` • `Supply Chain` • `Agentic Workflows` • `Engineering Governance` • `RAG` • `PostgreSQL` • `BullMQ`

</div>

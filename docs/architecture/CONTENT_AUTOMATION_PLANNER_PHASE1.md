# Content Automation Planner Phase 1

## 1. Goal
This phase aims to evolve ROCK BASE from a manual bulk-posting tool into a strategic content planning assistant. The primary goal is to automate the ideation process for large-scale Instagram campaigns across many accounts, helping users decide what to post. All generated content plans will remain under strict manual operator review before being published, ensuring quality control and brand safety.

## 2. Core Principle
The development of Phase 1 adheres to these non-negotiable principles:
- **No auto-posting:** The system will generate plans, not execute them automatically.
- **No direct ComfyUI call in Phase 1:** Visual prompt seeds will be generated, but the rendering process is out of scope for this phase.
- **No posting engine changes:** The core posting mechanism remains untouched.
- **No Compose posting logic changes:** The Compose feature will receive drafts, but its internal logic is not modified.
- **Everything must be review-gated:** No content can be published without explicit operator approval.
- **Operator approval is required before anything goes to Compose:** This is the final checkpoint to ensure safety and alignment.

## 3. Target Flow
The intended workflow for the Content Automation Planner is as follows:

Account Group
→ Campaign Topic
→ Content Pillars
→ AI Content Plan
→ Per-account Content Assignments
→ Caption/Hashtag Drafts
→ Visual Prompt Seeds
→ Operator Review
→ Approved Drafts
→ Send to Compose

## 4. Required Concepts
- **Account Group:** A logical cluster of Instagram accounts (e.g., "Jakarta Showrooms," "Bali Granite Suppliers") managed as a single unit for campaign planning.
- **Brand Tag:** A label to associate content with a specific brand, client, or internal project for organization and filtering.
- **Material Topic:** The central theme or product for the content, such as "Carrara Marble," "Black Galaxy Granite," or "Minimalist Kitchen Renovation."
- **Content Pillar:** A high-level content category that guides the narrative. Examples include "Education," "Inspiration," or "Promotional."
- **Content Angle:** A specific perspective or story taken within a Content Pillar. For the "Education" pillar, an angle could be "How to Clean Marble."
- **Caption Seed:** A starting phrase or core idea for a caption, designed to be expanded by an AI or the operator. E.g., "Discuss the durability of quartz..."
- **Hook Seed:** A short, attention-grabbing phrase for the first line of a caption. E.g., "You won't believe this..."
- **Hashtag Set:** A pre-defined collection of hashtags relevant to a material, pillar, or campaign.
- **CTA (Call to Action):** A directive encouraging user interaction, such as "Visit our showroom" or "Click the link in bio."
- **Visual Prompt Seed:** A descriptive text string intended for a future AI image generator (like ComfyUI) to create a visual asset.
- **Content Variation:** A set of rules and logic to ensure that content posted across multiple accounts is unique and not repetitive.
- **Duplicate Prevention:** A system to track posted content ideas (pillar + angle + material) to avoid re-posting identical concepts too frequently.
- **Review Gate:** The mandatory manual approval step where an operator checks, edits, and approves or rejects generated content plans before they can be sent to Compose.
- **Approved Draft:** A content assignment that has passed the Review Gate and is ready to be sent to the Compose module.
- **Render Spec:** A detailed JSON object created from an approved draft, containing all information needed for an external service (like ComfyUI) to generate a visual asset.
- **Generated Content Workspace:** A dedicated UI area for operators to review, approve, or reject visual assets created by the AI image generator.

## 5. Example Content Pillars
Examples for marble, granite, and interior design accounts:

| Pillar | Purpose | Example Angle | Example Caption Seed | Example Visual Prompt Seed |
| --- | --- | --- | --- | --- |
| **Edukasi Material** | Inform and educate the audience about materials. | The difference between marble and granite. | "Banyak yang belum tahu, marmer dan granit itu beda lho. Granit lebih keras dan tahan gores karena..." | `photorealistic, macro shot of marble and granite side-by-side, showing crystal structure differences, studio lighting` |
| **Inspirasi Interior** | Provide design ideas and inspiration. | Kitchen island with a waterfall edge. | "Bayangkan punya kitchen island mewah seperti ini di rumah. Desain waterfall edge bikin..." | `photorealistic, modern luxury kitchen, large marble island with waterfall edge, warm morning light, interior design magazine style` |
| **Before-After** | Showcase the transformative power of renovation. | Old kitchen vs. new kitchen with stone countertops. | "Transformasi dapur yang bikin pangling! Dari yang biasa aja jadi super mewah dengan top table..." | `side-by-side photo, (left) old dated kitchen with laminate counters, (right) the same kitchen renovated with new white granite countertops` |
| **Stok / Slab Highlight** | Feature specific inventory. | Highlight a unique slab of Blue Bahia granite. | "Stok terbatas! Slab Blue Bahia eksotis dengan corak biru yang memukau. Cocok untuk..." | `full slab photo, Blue Bahia granite, showcasing the vibrant blue and gold patterns, warehouse lighting, slight angle` |
| **Tips Renovasi** | Give practical advice for home improvement. | Budgeting for a kitchen renovation. | "Mau renovasi dapur tapi budget terbatas? Ini 3 tips jitu dari kami untuk menghemat biaya tanpa..." | `infographic style, illustration of a calculator and a kitchen blueprint, text "Tips Hemat Renovasi Dapur"` |
| **Trust / Showroom Proof** | Build credibility and social proof. | A shot of the team consulting with a client. | "Tim kami selalu siap membantu Anda memilih material terbaik. Di showroom kami, Anda bisa..." | `candid photo, friendly staff member talking to a customer in a well-lit stone showroom, large slabs in background` |
| **Promo Soft Selling** | Announce promotions subtly. | Weekend promo for a specific material. | "Akhir pekan ini waktu yang pas buat mampir ke showroom. Ada penawaran spesial untuk..." | `elegant graphic, text "Weekend Special" over a blurred image of a beautiful marble texture` |
| **Project Showcase** | Display completed projects. | A recently completed hotel lobby project. | "Bangga menjadi bagian dari proyek lobi hotel XYZ. Marmer dari kami memberikan sentuhan..." | `architectural photo, wide-angle shot of a luxury hotel lobby, focusing on the polished marble floor and reception desk` |
| **Comparison Content** | Help customers make informed decisions. | Quartz vs. Granite countertops. | "Pilih Quartz atau Granit untuk top table? Keduanya punya plus minus. Ini perbandingannya..." | `split image, (left) close-up of a quartz countertop, (right) close-up of a granite countertop, with labels "Quartz" and "Granite"` |
| **Maintenance Tips** | Provide value by teaching proper care. | How to remove stains from marble. | "Noda di meja marmer bikin panik? Tenang, ini cara mudah dan aman untuk menghilangkannya..." | `short video prompt, hands gently cleaning a small stain on a white marble surface with a soft cloth and a cleaning solution` |

## 6. Per-Account Variation Rules
To avoid repetitive content and maintain authenticity across a large number of accounts:
- **Do not use the same caption across accounts.** Each caption must be regenerated or spun from a seed to be unique.
- **Rotate hooks.** Use different opening lines for the same core topic.
- **Rotate CTA.** Vary the call to action to test effectiveness and reduce monotony.
- **Rotate hashtags.** Use different combinations from a relevant hashtag set.
- **Rotate content angle.** If posting about "Carrara Marble," one account might focus on "affordability" while another focuses on "luxury history."
- **Rotate content format.** For the same topic, one account might get a single image post, another a carousel, and a third a video/reel idea.
- **Keep brand/material consistency.** An account group dedicated to a specific brand should only post content relevant to that brand.
- **Avoid identical visual prompts.** Add random elements or slightly different parameters to visual prompt seeds.
- **Avoid posting the same material with the same angle across many accounts on the same day.** Stagger similar content over time and across different account groups.
- **Use account group context to decide content style.** A "luxury architect" group should have a different tone and visual style than a "budget contractor" group.

## 7. Example Per-Account Assignment Output
| Account | Group | Brand Tag | Material Topic | Pillar | Angle | Hook Seed | Caption Seed | Hashtag Set | CTA | Visual Prompt Seed | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| @marble.jakarta | JKT-Luxury | SuperStone | Statuario Marble | Inspirasi | Bathroom luxury | "Kamar mandi impian." | "Kamar mandi mewah dengan marmer Statuario. Dinding dan lantai..." | #luxuryinteriors | Hubungi kami | `photorealistic, luxury master bathroom, statuario marble on walls and floor, freestanding tub, gold fixtures` | Draft |
| @granit.murah.bali | BALI-Budget | RKB-Generic | Black Granite | Edukasi | Durability | "Top table anti gores!" | "Kenapa granit hitam jadi pilihan utama untuk dapur? Karena selain..." | #dapurminimalis | Cek link di bio | `photo, black granite countertop, someone is chopping vegetables directly on it to show durability` | Draft |
| @interior.depok | JABO-Design | ProDesign | Quartz | Comparison | Quartz vs. Marble | "Bimbang pilih mana?" | "Quartz atau Marmer? Untuk dapur sibuk, quartz lebih tahan noda..." | #kitchendesign | Konsultasi gratis | `split image, (left) white quartz counter, (right) white marble counter, with a pros and cons list` | Draft |
| @stone.surabaya | SUB-Supplier | MegaStone | Travertine | Project | Cafe design | "Cafe baru di Surabaya." | "Senang bisa supply travertine untuk lantai cafe XYZ. Suasananya jadi..." | #cafedesign | Kunjungi showroom | `photo, trendy cafe interior, travertine floor is the main feature, warm and cozy ambiance` | Draft |

## 8. Review Gate Rules
The review gate is a critical safety feature. All generated content plans are considered drafts until approved.
- **Generated plans are drafts only.** They hold no authority and cannot be posted automatically.
- **Operator must approve before sending to Compose.** The operator is the final decision-maker.
- **Operator can approve, edit, reject, or regenerate.** The UI must provide tools for these actions on a per-draft basis.
- **Rejected drafts must not be posted.** Rejected items are logged but never sent to the posting engine.
- **Drafts with missing context should be blocked.** The system should flag or prevent approval for drafts lacking a caption seed, visual idea, or brand context.
- **Approved drafts can be sent to Compose as assignment drafts.** This populates the Compose module, but does not schedule or post them.
- **Compose remains manual and safe.** The operator still has the final "post" button control within Compose.

## 9. Future ComfyUI Connection
While Phase 1 does not include direct integration, it must lay the groundwork for it.

**Future Flow:**
Approved content plan → creates `renderSpec` → `renderSpec` uses approved master asset → ComfyUI generates visual → output goes to **Generated Content Workspace** → operator reviews output → approve / regenerate / reject → approved asset can be sent to Compose.

**Key Principles for Future Integration:**
- **Phase 1 must not call ComfyUI.** This is a firm restriction. It only generates the text `visual prompt seed`.
- **Future ComfyUI calls must be async and review-gated.** Generation jobs should run in the background and their output must be manually approved.
- **Failed renders must not block existing posting features.** The system must be robust enough to handle generation failures without impacting the core functionality of ROCK BASE.

## 10. Suggested UI
A new "Content Planner" page will be created with the following features:
- **Setup:**
    - Dropdown to select **Account Group**.
    - Multi-select or dropdown for **Campaign Topic** / **Material Topic**.
    - Checkbox list to select desired **Content Pillars**.
- **Action:**
    - A "Generate Plan" button to trigger the AI planning process.
- **Review Interface:**
    - A table or card layout displaying the per-account drafts (similar to the example in section 7).
    - Each draft item shows: Account, Pillar, Angle, Caption, Hashtags, Visual Idea, Status.
    - Buttons on each draft: **Approve**, **Edit**, **Reject**, **Regenerate**.
    - An "Edit" action opens a modal to change any part of the draft.
- **Bulk Actions:**
    - "Approve Selected" or "Approve All" button.
    - A "Send Approved to Compose" button.
- **Warnings & Status:**
    - Visual warnings for potential duplicate content (e.g., "Similar angle used for @account.x yesterday").
    - Warnings for missing assets or context.
    - Status badges on each draft: `Draft`, `Needs Review`, `Approved`, `Rejected`, `Sent to Compose`.

## 11. Safe Implementation Phases
1.  **Phase 1: Docs-only architecture plan.** (This document)
2.  **Phase 2:** Frontend mock Content Planner UI with dummy data only.
3.  **Phase 3:** AI text-only plan generation (Caption, Hashtags, Angle).
4.  **Phase 4:** Save planner drafts safely to the database.
5.  **Phase 5:** Send approved caption/hashtag drafts to Compose Assignment Mode.
6.  **Phase 6:** Prepare `renderSpec` for ComfyUI without calling it.
7.  **Phase 7:** Build the Generated Content Workspace UI for future visual review.
8.  **Phase 8:** Real ComfyUI integration behind a review gate.
9.  **Phase 9:** Implement a calendar view for scheduled and planned content.
10. **Phase 10:** Integrate an analytics feedback loop to inform future content recommendations.

## 12. Validation Checklist
- [x] Only docs file created.
- [x] No backend runtime changed.
- [x] No frontend runtime changed.
- [x] No posting engine changed.
- [x] No Compose logic changed.
- [x] No Prisma schema changed.
- [x] No migration created.
- [x] No dev.db touched.
- [x] No .env touched.
- [x] No ComfyUI call.
- [x] No n8n call.
- [x] No auto-post.
- [x] `git status` shows only `docs/architecture/CONTENT_AUTOMATION_PLANNER_PHASE1.md`.

## 13. Final Summary
The Content Automation Planner will transform ROCK BASE by helping operators automatically generate diverse and strategic content ideas for many accounts at scale. Crucially, it empowers the operator, who remains in full control to review, approve, and manually send safe, pre-vetted drafts to the existing Compose module for final posting.

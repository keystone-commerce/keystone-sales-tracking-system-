# V1: customer request to ready for sourcing

Customer → requirements and contact method/evidence → agreed price or pricing/quotation → customer PO file and receipt details → Ready for sourcing.

New requests use Call, WhatsApp, Email, In person or Other. A request attachment is optional for every channel. On the agreed-price path, it is labelled Agreed price proof. Saving opens the request detail with the guided tracker. Calls use notes and SKU requirements.

The pricing-needed path supports unpriced requirements and price editing, followed by an externally shared quotation with its reference, sharing channel and document. Quotation snapshots are revisioned. Accepted prices stay locked after PO received. The agreed-price path skips a new quotation but still records the customer PO.

The PO step records a reference, PNG/JPG/WebP/PDF attachment, receipt method and received date. Ready for sourcing requires that the PO received step has been saved, every SKU is priced, the original request evidence is present when required and the shipping address is recorded. No automatic sourcing submission is connected. Delivery, invoices and payments remain out of scope.

Documents are protected by live order permissions, limited to 5 MB/file and 20/request, and stored in private S3 in production, with metadata in PostgreSQL. Local development retains database storage without AWS credentials. Download URLs require a session and order read permission; uploads require order update or the limited own-create request-evidence exception. Uploads, changes and quotation revisions appear in expandable request history. Old audit entries contain only details captured at that time. Failed multi-part form uploads preserve the saved request and offer retry without recreating it.

Quotation generation/sending, WhatsApp/email inbox integration, OCR, document deletion and post-acceptance commercial corrections are not implemented. Contact method and sharing evidence are manually recorded. Legacy orders retain their previous data/stages.

Hosting preparation remains Vercel frontend and AWS backend/RDS. Nothing deployed or pushed. Back up database metadata and protect/restore private S3 objects and their recorded versions together. Test real hosting upload limits and cookie/document downloads before deployment.


## Order amendments

Add SKUs / revise PO starts a version-checked amendment after initial PO receipt, or adds further SKUs while a revision is pending. New SKUs require agreed selling prices and cannot duplicate an existing code. Existing accepted items remain immutable. A reason, before/after item snapshots and the order revision are retained in history. PO-only revisions are supported with no added SKUs. Current readiness is withdrawn until a newly uploaded PO for the current order revision is received. Prior PO documents/references stay available in history. Stale uploads and edits are rejected. Orders already linked to sourcing, dispatch or invoicing are blocked from this pre-sourcing amendment flow.

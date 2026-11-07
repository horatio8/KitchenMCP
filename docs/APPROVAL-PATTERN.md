# Sending a finished artefact for approval

The pattern to follow whenever a deliverable is finished and goes to a
client for approval. Specified by James Flynn, 7 November 2026.

## Why it is shaped this way

Kitchen's doc object has no writable body. The API exposes `title`,
`description` and `visibility` and nothing else — there is no content
field, no `/content` or `/blocks` endpoint, and `expand` is silently
ignored. So a Kitchen doc can be created for a client and never
filled.

An embed can. It holds a URL, so the text lives somewhere with a real
editor while still appearing inside the client's folder in the portal.
That is the hinge the whole pattern turns on: the client edits in
Google Docs, and still only has one place to look.

## The four steps

### 1. Copy the verbatim copy into a Google Doc

The approved text, exactly as written. No summarising, no
reformatting, no helpful tightening. If the artefact is HTML, or has
markup that matters, carry it across so the client sees what will
actually ship.

### 2. Share it publicly, with edit access

Two things, and both matter.

**Link sharing must be on.** `anyone with the link`, not named
accounts. The client is not in the Teller Google Workspace, so a file
shared only with named accounts renders a Google sign-in wall inside
the Kitchen portal. The client cannot act on that, and it reads as the
portal being broken.

**The role is `writer`, not `commenter`.** The point is that they can
fix the words themselves rather than describing the fix in a comment
thread for someone to re-key.

So, before embedding:

```
share_file  fileId: <id>  permissionId: "anyoneWithLink"  role: "writer"
```

and confirm with `get_file_permissions`. The target state is exactly:

```json
{"id": "anyoneWithLink", "role": "writer", "type": "anyone"}
```

Verified: that is the live state of the file behind
`pe_386757c601eca1774f0c87b6`, and an anonymous fetch with no Google
session returns 200 with the full text.

**The tradeoff, stated once.** `anyone with the link` + `writer` means
anyone holding the URL can edit the document, not only the client.
The URL lives in the client's shared Kitchen folder, so in practice
the audience is whoever can reach that folder plus anyone they forward
it to. That is the price of a client editing without a login, and it
is accepted deliberately. Do not use this for anything whose contents
would matter in a stranger's hands.

**Watch the `/u/<n>/` trap.** A URL copied from the browser bar of a
signed-in account looks like
`docs.google.com/document/u/0/d/<id>/edit`. That `/u/0/` pins the link
to the *opener's* account slot, so it resolves to a file the client has
no access to — a permission error on a document that is genuinely
public. `kitchen_create_embed` strips it automatically and says so, but
it is worth recognising by eye.

### 3. File it under `Teller > Clients > <Client>`

Google Drive, shared drive. Confirmed live:

- `Teller` — `1xmDxN_DuL-QJsQM7OEV9NHYUFlYGF448`
- `Clients` — `1ASwqI8QxEyvzCFvFgIR-_yxZFDOSiJo4`
- ~48 client subfolders beneath it, e.g. `Farmers Fightback`
  (`1Qwr0AYrNIuJBmG-dv5NWsIHQHZ-SYpps`), `Defend Australia`
  (`1Q8f1LxWNsq_9eu7zqT4KydpSpFIykBkl`), `Johnnie Garmon SC 115`
  (`169qOv2tP_LwlJMnI9cfd6ZfgV7is8zBn`).

This is the archive. Every past version of every document the client
has seen stays here, in the agency's own Drive, independent of
Kitchen's retention and of whatever the client later does to the doc.

If the client has no folder, say so and ask before creating one.

### 4. Embed it in the client's shared Kitchen folder

`kitchen_create_embed` with the Google Doc's `/edit` URL,
`visibility: "shared"`, `folder` set to the client's shared Kitchen
folder, and `link_sharing_confirmed: true` once step 2 is done. Then
`kitchen_create_embed_membership` to grant the client `embed_manager`
(or `embed_viewer` if they should read only).

`link_sharing_confirmed` is an attestation, not a verification: this
server holds no Google credentials and cannot see Drive. It exists so
that the step cannot be skipped silently by any client of this MCP,
including ones that have never read this document.

Note the object: **an embed (`pe_…`), not a doc (`doc_…`)**. A doc
cannot hold the Google Doc, for the reason above.

## The working example

`pe_386757c601eca1774f0c87b6`, created 7 Nov 11:04 by hand:

```
title:       Media Release 1: 50,000 Australians speak up (editable)
description: For review. Edit the text directly. Send [day] [date]
             to Defend Sacred Ground MEDIA.
url:         https://docs.google.com/document/d/1rNqKhU96T7MM9H7epZXHxXPAyv5QMCUHwNvLPYlhmuw/edit
visibility:  shared
```

Two things worth copying from it: `(editable)` in the title, and a
description that says what the client is expected to do. Neither is
decoration — an embed looks like a link until something tells the
reader it is theirs to change.

## Preconditions the server enforces

Anything that exposes a doc or an embed to a client first checks that
a shared folder for client work exists. If none does, the tool does
not act and does not guess: it returns `status: "needs_user_decision"`
with a question, the shared folders that do exist, and the exact call
that would create one. Deciding how a client's workspace is organised
is the client's call, not the server's.

Enforced on `kitchen_create_doc`, `kitchen_update_doc`,
`kitchen_create_doc_membership`, `kitchen_create_embed`,
`kitchen_update_embed` and `kitchen_create_embed_membership`.

`kitchen_create_embed` and `kitchen_update_embed` additionally refuse a
Google document until `link_sharing_confirmed` is passed, and strip
account-scoped `/u/<n>/` URLs on the way through. The sharing check
runs before the folder check because it costs no API calls.

All asserted in `scripts/test-client-sharing.mjs`.

## API facts found the hard way

None of these are in the published documentation. Each was established
against the live workspace.

- **A client cannot be added to a resource that is not already
  shared.** Kitchen returns `400 "Could not add a client, because the
  resource is not shared"`. Set `visibility: "shared"` at creation —
  fixing it afterwards costs an extra call and an extra permission
  prompt.
- **There is no `/api/users/{id}`.** It 404s. `/api/clients/{id}` is
  the discriminator: it returns the user for a client and 404s with
  `"No query results for model [App\User]"` for a team member.
- **Doc roles are `document_*`** (`document_admin`, `document_manager`,
  `document_editor`, `document_viewer`) against a resource called
  `doc`. **Embed roles are `embed_*`** (`embed_admin`, `embed_manager`,
  `embed_viewer`). The two do not match, and neither follows its own
  resource name.
- **A doc's parent folder is not on the doc object.** There is no way
  to ask where a doc lives; you find it by listing folder children.

---
phase: 02-identiteit-bestanden
plan_id: 02-11-i18n-catalog-additions
plan: 11
type: execute
wave: 3
depends_on: []
files_modified:
  - messages/nl.json
  - messages/en.json
  - messages/fr.json
  - docs/i18n-conventions.md
autonomous: true
requirements:
  - I18N-06
  - I18N-08
  - PLAYER-05
  - PLAYER-07
  - TRAINER-01

must_haves:
  truths:
    - "messages/nl.json, en.json, fr.json each receive ≥50 new keys under players.*, trainers.*, files.*, lookups.{ageCategory,trainerDiploma}.*, errors.field.*"
    - "All canonical text from UI-SPEC §Copywriting Contract is present verbatim in the matching locale"
    - "lookups.academy.* extended for the 4 new academy codes (placeholders match seed data)"
    - "lookups.ageCategory.* (singular root retained for new entries — UI-SPEC line 271 reconciliation: keep `lookups.*` plural)"
    - "Three catalogs are in PARITY — every new key exists in all 3 locales"
    - "Proper nouns (academy canonical names, person names) appear IDENTICALLY in nl/en/fr (D-45)"
    - "docs/i18n-conventions.md documents the proper-noun rule + lookup-label resolver pattern"
  artifacts:
    - path: "messages/nl.json"
      provides: "Dutch labels for all Phase 2 surfaces"
      contains: "Spelers"
    - path: "messages/en.json"
      provides: "English labels"
      contains: "Players"
    - path: "messages/fr.json"
      provides: "French labels"
      contains: "Joueurs"
    - path: "docs/i18n-conventions.md"
      provides: "developer doc on proper-noun rule + lookup resolver"
      contains: "I18N-06"
  key_links:
    - from: "messages/{nl,en,fr}.json (lookups.academy.*)"
      to: "src/server/db/schema/lookups.ts (academy.canonicalName)"
      via: "i18n key values duplicate the canonical_name verbatim across all 3 locales (D-45)"
      pattern: "Topsportschool"
---

<objective>
Populate the i18n message catalogs with every key needed by Phase 2 UI surfaces (forms, list pages, photo widget, error toasts, lookup labels). All three locales (nl, en, fr) receive the same set of keys in parity — missing keys in dev fail loud (D-20 Phase 1), and the Phase 8 CI gate (I18N-10) blocks shipping with gaps.

Every canonical string in `02-UI-SPEC.md §Copywriting Contract` is the source of truth — copy verbatim into the matching locale. Proper nouns (academy canonical names, club names, person names) appear identically in all three catalogs per I18N-06/D-45.

Also produce `docs/i18n-conventions.md` to document the proper-noun rule for future contributors.

Output: 3 JSON catalogs updated, 1 doc.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-UI-SPEC.md
@messages/nl.json
@messages/en.json
@messages/fr.json
@CLAUDE.md

<interfaces>
<!-- Existing catalog top-level shape (Phase 1) -->

```json
{
  "auth": { ... },
  "consent": { ... },
  "lookups": {           // ← Phase 2 keeps the PLURAL root (UI-SPEC line 271)
    "status": { "status_a": "...", "status_b": "...", "status_c": "..." },
    "academy": { "topsportschool": "Topsportschool", "academy_antwerpen": "..." },
    "trainingType": { ... },
    "tournamentType": { ... },
    "rankingType": { ... },
    "organisation": { ... },
    "outcomeLevel": { ... }
  },
  "common": { "save", "cancel", ... },
  "nav": { "dashboard", "calendar", "players", "trainers", ... },
  "errors": { "generic", "forbidden", "notFound", "validationFailed", "csrfRejected" },
  "admin": { ... }
}
```

Phase 2 ADDS (top-level):
- `players` namespace (~25 keys: list/create/detail/edit/sections/empty/actions/ageCategoryChange)
- `trainers` namespace (~15 keys)
- `files` namespace (~15 keys for photo upload)
- `me` namespace (1 key for /me/profile title)
- Extends `lookups.academy` with 4 new codes
- Adds `lookups.ageCategory` (7 codes)
- Adds `lookups.trainerDiploma` (5 codes)
- Extends `errors.field` (6 new keys: required, email, dateInPast, belgianPostalCode, phone, emergencyContactRequiredForMinor)
- Extends `errors.file` (5 new keys: tooLarge, unknownType, disallowedType, signedUrlFailed, uploadFailed, scanNotClean, filenameTooLong)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend messages/nl.json with all Phase 2 keys</name>
  <read_first>
    - messages/nl.json (entire file — confirm current top-level keys + structure)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Copywriting Contract (nl column is source of truth)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Lookup-Tabel Data Seeding Strategy (canonical labels for lookups)
  </read_first>
  <files>
    messages/nl.json
  </files>
  <action>
    Edit `messages/nl.json` — preserve every existing top-level key and existing nested values. ADD the following new keys (and extend `lookups.academy` + `errors`).

    Inside the JSON object, add/extend:

    ```json
    "players": {
      "list": {
        "title": "Spelers",
        "empty": {
          "title": "Geen spelers in jouw scope",
          "body": "Spelers verschijnen hier zodra ze aan jouw academie zijn gekoppeld.",
          "ctaTd": "Nieuwe speler"
        },
        "actions": {
          "open": "Open profiel",
          "setAgeCategory": "Leeftijdscategorie wijzigen"
        }
      },
      "create": {
        "title": "Nieuwe speler aanmaken",
        "submit": "Speler aanmaken"
      },
      "detail": {
        "title": "Spelerprofiel",
        "readOnly": "Alleen-lezen"
      },
      "edit": {
        "submit": "Wijzigingen opslaan",
        "toast": {
          "saved": "Profiel opgeslagen",
          "error": "Opslaan mislukt — controleer de gegevens en probeer opnieuw"
        }
      },
      "sections": {
        "identity": "Identiteit",
        "sport": "Sport",
        "address": "Adres",
        "emergencyContact": "Noodcontact",
        "photo": "Profielfoto"
      },
      "fields": {
        "school": { "description": "(optioneel)" },
        "gender": {
          "label": "Geslacht",
          "male": "Man",
          "female": "Vrouw",
          "x": "X"
        }
      },
      "ageCategoryChange": {
        "title": "Leeftijdscategorie wijzigen?",
        "body": "Deze wijziging is doorzoekbaar in de historie. Toekomstige toernooi-validatie gebruikt deze categorie vanaf de ingangsdatum.",
        "confirm": "Wijzigen"
      }
    },
    "trainers": {
      "list": {
        "title": "Trainers",
        "empty": {
          "title": "Geen trainers in jouw scope",
          "body": "Trainers verschijnen hier zodra zij aan jouw academie zijn gekoppeld.",
          "ctaTd": "Nieuwe trainer"
        },
        "actions": {
          "open": "Open profiel"
        }
      },
      "create": {
        "title": "Nieuwe trainer aanmaken",
        "submit": "Trainer aanmaken"
      },
      "detail": {
        "title": "Trainersprofiel",
        "readOnly": "Alleen-lezen"
      },
      "edit": {
        "submit": "Wijzigingen opslaan",
        "toast": {
          "saved": "Profiel opgeslagen",
          "error": "Opslaan mislukt — controleer de gegevens en probeer opnieuw"
        }
      }
    },
    "me": {
      "profile": {
        "title": "Mijn profiel"
      }
    },
    "files": {
      "photo": {
        "dropzone": {
          "idle": "Sleep een foto hierheen of klik om te bladeren — JPEG of PNG, max 2 MB",
          "dragging": "Laat los om te uploaden"
        },
        "uploading": "Bezig met uploaden…",
        "scanPending": "Foto wordt gescand op virussen — duurt meestal 1–5 seconden",
        "scanInfected": "Bestand afgekeurd door scan. Kies een andere foto.",
        "scanTimeout": "Scan duurt langer dan verwacht. Klik op vernieuwen om opnieuw te controleren.",
        "actions": {
          "replace": "Vervangen",
          "delete": "Verwijderen"
        },
        "toast": {
          "uploaded": "Foto opgeslagen"
        },
        "deleteConfirm": {
          "title": "Profielfoto verwijderen?",
          "body": "De huidige foto wordt vervangen door initialen. Dit is omkeerbaar — een nieuwe foto kan altijd worden geüpload.",
          "confirm": "Verwijderen",
          "cancel": "Annuleren"
        },
        "errors": {
          "tooLarge": "Bestand is te groot. Maximum 2 MB.",
          "wrongType": "Alleen JPEG of PNG toegestaan.",
          "multiFile": "Eén foto tegelijk"
        }
      }
    }
    ```

    Inside the existing `lookups` object, ADD/extend (do NOT remove the Phase 1 entries):

    ```json
    "lookups": {
      // ... existing status, academy, trainingType, tournamentType, rankingType, organisation, outcomeLevel ...
      "academy": {
        "topsportschool": "Topsportschool",
        "academy_antwerpen": "Academy Antwerpen",
        "academy_brussel": "Academy Brussel",
        "academy_oost_vlaanderen": "Academy Oost-Vlaanderen",
        "academy_west_vlaanderen": "Academy West-Vlaanderen",
        "academy_limburg": "Academy Limburg"
      },
      "ageCategory": {
        "age_pre_minor": "Preminiemen",
        "age_minor": "Miniemen",
        "age_cadet": "Cadetten",
        "age_junior": "Junioren",
        "age_senior": "Senioren",
        "age_veteran": "Veteranen",
        "age_unknown": "Niet bepaald"
      },
      "trainerDiploma": {
        "diploma_none": "Geen",
        "diploma_a": "Diploma A",
        "diploma_b": "Diploma B",
        "diploma_a_in_training": "Diploma A in opleiding",
        "diploma_b_in_training": "Diploma B in opleiding"
      }
    }
    ```

    Inside the existing `errors` object, ADD:

    ```json
    "errors": {
      // ... existing generic, forbidden, notFound, validationFailed, csrfRejected ...
      "field": {
        "required": "Dit veld is verplicht",
        "email": "Geen geldig e-mailadres",
        "dateInPast": "Datum moet in het verleden liggen",
        "belgianPostalCode": "Geef een postcode van 4 cijfers",
        "country": "Geef een geldige landcode (2 letters)",
        "phone": "Geef een geldig telefoonnummer",
        "emergencyContactRequiredForMinor": "Noodcontact is verplicht voor minderjarigen"
      },
      "file": {
        "tooLarge": "Bestand is te groot. Maximum 2 MB.",
        "unknownType": "Bestandstype kon niet worden bepaald.",
        "disallowedType": "Dit bestandstype is niet toegestaan voor dit upload-veld.",
        "filenameTooLong": "Bestandsnaam is te lang. Maximum 255 tekens.",
        "uploadFailed": "Upload mislukt. Probeer opnieuw.",
        "signedUrlFailed": "Kon geen download-link genereren.",
        "scanNotClean": "Bestand is nog niet beschikbaar — de virusscan loopt nog of het bestand werd geweigerd."
      }
    }
    ```

    Format the file as valid JSON (no trailing commas; preserve 2-space indentation matching Phase 1 style).

    Do NOT translate the academy canonical names to French in fr.json (D-45 — proper nouns identical across locales).
    Do NOT remove the existing `lookups.status.status_a` etc. entries; new entries are additive.
  </action>
  <verify>
    <automated>jq -e '.players.list.title == "Spelers"' messages/nl.json && jq -e '.trainers.list.title == "Trainers"' messages/nl.json && jq -e '.files.photo.dropzone.idle' messages/nl.json && jq -e '.lookups.academy.academy_limburg' messages/nl.json && jq -e '.lookups.ageCategory.age_pre_minor' messages/nl.json && jq -e '.lookups.trainerDiploma.diploma_a_in_training' messages/nl.json && jq -e '.errors.field.belgianPostalCode' messages/nl.json && jq -e '.errors.file.tooLarge' messages/nl.json && jq -e '.errors.field.emergencyContactRequiredForMinor' messages/nl.json && jq -e '.lookups.status.status_a' messages/nl.json</automated>
  </verify>
  <acceptance_criteria>
    - 5 new top-level keys (`players`, `trainers`, `me`, `files`) added (plus extensions to existing `lookups` and `errors`)
    - All canonical strings from UI-SPEC nl column present verbatim
    - 6 academies, 7 age-categories, 5 trainer diplomas in `lookups`
    - File is valid JSON (`jq . messages/nl.json` exits 0)
    - Phase 1 keys preserved (status_a, common.save, nav.dashboard etc.)
  </acceptance_criteria>
  <done>Dutch catalog complete.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extend messages/en.json with parity</name>
  <read_first>
    - messages/en.json (current Phase 1 content)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Copywriting Contract (en column — source of truth)
  </read_first>
  <files>
    messages/en.json
  </files>
  <action>
    Mirror Task 1 structure exactly. Use the English values from UI-SPEC nl/en/fr table.

    Key values (verbatim from UI-SPEC):

    - `players.list.title` → `"Players"`
    - `players.list.empty.title` → `"No players in your scope"`
    - `players.list.empty.body` → `"Players will appear here once they are linked to your academy."`
    - `players.list.empty.ctaTd` → `"New player"`
    - `players.list.actions.open` → `"Open profile"`
    - `players.list.actions.setAgeCategory` → `"Change age category"`
    - `players.create.title` → `"Create new player"`
    - `players.create.submit` → `"Create player"`
    - `players.detail.title` → `"Player profile"`
    - `players.detail.readOnly` → `"Read-only"`
    - `players.edit.submit` → `"Save changes"`
    - `players.edit.toast.saved` → `"Profile saved"`
    - `players.edit.toast.error` → `"Save failed — review the data and try again"`
    - `players.sections.identity` → `"Identity"`
    - `players.sections.sport` → `"Sport"`
    - `players.sections.address` → `"Address"`
    - `players.sections.emergencyContact` → `"Emergency contact"`
    - `players.sections.photo` → `"Profile photo"`
    - `players.fields.school.description` → `"(optional)"`
    - `players.fields.gender.label` → `"Gender"`, `.male` → `"Male"`, `.female` → `"Female"`, `.x` → `"X"`
    - `players.ageCategoryChange.title` → `"Change age category?"`
    - `players.ageCategoryChange.body` → `"This change is logged in the history. Future tournament validation uses this category from the effective date onwards."`
    - `players.ageCategoryChange.confirm` → `"Change"`

    - `trainers.list.title` → `"Trainers"`
    - `trainers.list.empty.title` → `"No trainers in your scope"`
    - `trainers.list.empty.body` → `"Trainers will appear here once they are linked to your academy."`
    - `trainers.list.empty.ctaTd` → `"New trainer"`
    - `trainers.list.actions.open` → `"Open profile"`
    - `trainers.create.title` → `"Create new trainer"`
    - `trainers.create.submit` → `"Create trainer"`
    - `trainers.detail.title` → `"Trainer profile"`
    - `trainers.detail.readOnly` → `"Read-only"`
    - `trainers.edit.submit` → `"Save changes"`
    - `trainers.edit.toast.saved` → `"Profile saved"`
    - `trainers.edit.toast.error` → `"Save failed — review the data and try again"`

    - `me.profile.title` → `"My profile"`

    - `files.photo.dropzone.idle` → `"Drag a photo here or click to browse — JPEG or PNG, max 2 MB"`
    - `files.photo.dropzone.dragging` → `"Release to upload"`
    - `files.photo.uploading` → `"Uploading…"`
    - `files.photo.scanPending` → `"Scanning photo for viruses — usually 1–5 seconds"`
    - `files.photo.scanInfected` → `"File rejected by scan. Pick a different photo."`
    - `files.photo.scanTimeout` → `"Scan is taking longer than expected. Click refresh to check again."`
    - `files.photo.actions.replace` → `"Replace"`
    - `files.photo.actions.delete` → `"Delete"`
    - `files.photo.toast.uploaded` → `"Photo saved"`
    - `files.photo.deleteConfirm.title` → `"Delete profile photo?"`
    - `files.photo.deleteConfirm.body` → `"The current photo will be replaced with initials. This is reversible — a new photo can always be uploaded."`
    - `files.photo.deleteConfirm.confirm` → `"Delete"`
    - `files.photo.deleteConfirm.cancel` → `"Cancel"`
    - `files.photo.errors.tooLarge` → `"File is too large. Maximum 2 MB."`
    - `files.photo.errors.wrongType` → `"Only JPEG or PNG allowed."`
    - `files.photo.errors.multiFile` → `"One photo at a time"`

    `lookups.academy.*` — copy nl values VERBATIM (D-45 — proper nouns identical across locales):
    - `"topsportschool": "Topsportschool"`, `"academy_antwerpen": "Academy Antwerpen"`, `"academy_brussel": "Academy Brussel"`, `"academy_oost_vlaanderen": "Academy Oost-Vlaanderen"`, `"academy_west_vlaanderen": "Academy West-Vlaanderen"`, `"academy_limburg": "Academy Limburg"`.

    `lookups.ageCategory.*`:
    - `"age_pre_minor": "Pre-minors"`, `"age_minor": "Minors"`, `"age_cadet": "Cadets"`, `"age_junior": "Juniors"`, `"age_senior": "Seniors"`, `"age_veteran": "Veterans"`, `"age_unknown": "Not determined"`.

    `lookups.trainerDiploma.*` (en values per RESEARCH §trainer_diploma table):
    - `"diploma_none": "None"`, `"diploma_a": "Diploma A"`, `"diploma_b": "Diploma B"`, `"diploma_a_in_training": "Diploma A in training"`, `"diploma_b_in_training": "Diploma B in training"`.

    `errors.field.*`:
    - `"required": "This field is required"`, `"email": "Not a valid email address"`, `"dateInPast": "Date must be in the past"`, `"belgianPostalCode": "Enter a 4-digit postal code"`, `"country": "Enter a valid country code (2 letters)"`, `"phone": "Enter a valid phone number"`, `"emergencyContactRequiredForMinor": "Emergency contact is required for minors"`.

    `errors.file.*`:
    - `"tooLarge": "File is too large. Maximum 2 MB."`, `"unknownType": "File type could not be determined."`, `"disallowedType": "This file type is not allowed for this upload field."`, `"filenameTooLong": "Filename is too long. Maximum 255 characters."`, `"uploadFailed": "Upload failed. Please try again."`, `"signedUrlFailed": "Could not generate download link."`, `"scanNotClean": "File is not yet available — the virus scan is in progress or the file was rejected."`.
  </action>
  <verify>
    <automated>jq -e '.players.list.title == "Players"' messages/en.json && jq -e '.files.photo.scanInfected | contains("rejected")' messages/en.json && jq -e '.lookups.academy.topsportschool == "Topsportschool"' messages/en.json && jq -e '.lookups.ageCategory.age_unknown == "Not determined"' messages/en.json && jq -e '.errors.field.belgianPostalCode | contains("4-digit")' messages/en.json && jq -e '.errors.file.scanNotClean' messages/en.json</automated>
  </verify>
  <acceptance_criteria>
    - All EN canonical strings from UI-SPEC verbatim
    - Proper-noun rule honored: `lookups.academy.topsportschool == "Topsportschool"` (identical to nl)
    - File is valid JSON
  </acceptance_criteria>
  <done>English catalog at parity with nl.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Extend messages/fr.json with parity</name>
  <read_first>
    - messages/fr.json (current Phase 1 content)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Copywriting Contract (fr column — source of truth)
  </read_first>
  <files>
    messages/fr.json
  </files>
  <action>
    Same structure as Task 2 but with French values from UI-SPEC.

    Key values (verbatim from UI-SPEC):

    - `players.list.title` → `"Joueurs"`
    - `players.list.empty.title` → `"Aucun joueur dans votre périmètre"`
    - `players.list.empty.body` → `"Les joueurs apparaîtront ici dès qu'ils seront liés à votre académie."`
    - `players.list.empty.ctaTd` → `"Nouveau joueur"`
    - `players.list.actions.open` → `"Ouvrir le profil"`
    - `players.list.actions.setAgeCategory` → `"Changer la catégorie d'âge"`
    - `players.create.title` → `"Créer un nouveau joueur"`
    - `players.create.submit` → `"Créer le joueur"`
    - `players.detail.title` → `"Profil du joueur"`
    - `players.detail.readOnly` → `"Lecture seule"`
    - `players.edit.submit` → `"Enregistrer les modifications"`
    - `players.edit.toast.saved` → `"Profil enregistré"`
    - `players.edit.toast.error` → `"Échec de l'enregistrement — vérifiez les données et réessayez"`
    - `players.sections.identity` → `"Identité"`
    - `players.sections.sport` → `"Sport"`
    - `players.sections.address` → `"Adresse"`
    - `players.sections.emergencyContact` → `"Contact d'urgence"`
    - `players.sections.photo` → `"Photo de profil"`
    - `players.fields.school.description` → `"(optionnel)"`
    - `players.fields.gender.label` → `"Genre"`, `.male` → `"Homme"`, `.female` → `"Femme"`, `.x` → `"X"`
    - `players.ageCategoryChange.title` → `"Changer la catégorie d'âge ?"`
    - `players.ageCategoryChange.body` → `"Cette modification est enregistrée dans l'historique. La validation des futurs tournois utilisera cette catégorie à partir de la date d'effet."`
    - `players.ageCategoryChange.confirm` → `"Changer"`

    - `trainers.list.title` → `"Entraîneurs"`
    - `trainers.list.empty.title` → `"Aucun entraîneur dans votre périmètre"`
    - `trainers.list.empty.body` → `"Les entraîneurs apparaîtront ici dès qu'ils seront liés à votre académie."`
    - `trainers.list.empty.ctaTd` → `"Nouvel entraîneur"`
    - `trainers.list.actions.open` → `"Ouvrir le profil"`
    - `trainers.create.title` → `"Créer un nouvel entraîneur"`
    - `trainers.create.submit` → `"Créer l'entraîneur"`
    - `trainers.detail.title` → `"Profil de l'entraîneur"`
    - `trainers.detail.readOnly` → `"Lecture seule"`
    - `trainers.edit.submit` → `"Enregistrer les modifications"`
    - `trainers.edit.toast.saved` → `"Profil enregistré"`
    - `trainers.edit.toast.error` → `"Échec de l'enregistrement — vérifiez les données et réessayez"`

    - `me.profile.title` → `"Mon profil"`

    - `files.photo.dropzone.idle` → `"Glissez une photo ici ou cliquez pour parcourir — JPEG ou PNG, max 2 Mo"`
    - `files.photo.dropzone.dragging` → `"Relâchez pour téléverser"`
    - `files.photo.uploading` → `"Téléversement…"`
    - `files.photo.scanPending` → `"Analyse antivirus en cours — généralement 1 à 5 secondes"`
    - `files.photo.scanInfected` → `"Fichier rejeté par l'analyse. Choisissez une autre photo."`
    - `files.photo.scanTimeout` → `"L'analyse prend plus de temps que prévu. Cliquez sur actualiser pour vérifier à nouveau."`
    - `files.photo.actions.replace` → `"Remplacer"`
    - `files.photo.actions.delete` → `"Supprimer"`
    - `files.photo.toast.uploaded` → `"Photo enregistrée"`
    - `files.photo.deleteConfirm.title` → `"Supprimer la photo de profil ?"`
    - `files.photo.deleteConfirm.body` → `"La photo actuelle sera remplacée par les initiales. Cette action est réversible — une nouvelle photo peut toujours être téléversée."`
    - `files.photo.deleteConfirm.confirm` → `"Supprimer"`
    - `files.photo.deleteConfirm.cancel` → `"Annuler"`
    - `files.photo.errors.tooLarge` → `"Le fichier est trop volumineux. Maximum 2 Mo."`
    - `files.photo.errors.wrongType` → `"Seuls les fichiers JPEG ou PNG sont autorisés."`
    - `files.photo.errors.multiFile` → `"Une seule photo à la fois"`

    `lookups.academy.*` — copy nl values VERBATIM (D-45):
    - `"topsportschool": "Topsportschool"`, `"academy_antwerpen": "Academy Antwerpen"`, `"academy_brussel": "Academy Brussel"`, `"academy_oost_vlaanderen": "Academy Oost-Vlaanderen"`, `"academy_west_vlaanderen": "Academy West-Vlaanderen"`, `"academy_limburg": "Academy Limburg"`.

    `lookups.ageCategory.*` (fr names — Belgian table tennis French translations):
    - `"age_pre_minor": "Préminimes"`, `"age_minor": "Minimes"`, `"age_cadet": "Cadets"`, `"age_junior": "Juniors"`, `"age_senior": "Seniors"`, `"age_veteran": "Vétérans"`, `"age_unknown": "Non déterminé"`.

    `lookups.trainerDiploma.*` (fr per RESEARCH §trainer_diploma):
    - `"diploma_none": "Aucun"`, `"diploma_a": "Diplôme A"`, `"diploma_b": "Diplôme B"`, `"diploma_a_in_training": "Diplôme A en formation"`, `"diploma_b_in_training": "Diplôme B en formation"`.

    `errors.field.*`:
    - `"required": "Ce champ est obligatoire"`, `"email": "Adresse e-mail non valide"`, `"dateInPast": "La date doit être dans le passé"`, `"belgianPostalCode": "Entrez un code postal de 4 chiffres"`, `"country": "Entrez un code pays valide (2 lettres)"`, `"phone": "Entrez un numéro de téléphone valide"`, `"emergencyContactRequiredForMinor": "Un contact d'urgence est obligatoire pour les mineurs"`.

    `errors.file.*`:
    - `"tooLarge": "Le fichier est trop volumineux. Maximum 2 Mo."`, `"unknownType": "Le type de fichier n'a pas pu être déterminé."`, `"disallowedType": "Ce type de fichier n'est pas autorisé pour ce champ."`, `"filenameTooLong": "Le nom du fichier est trop long. Maximum 255 caractères."`, `"uploadFailed": "Échec du téléversement. Veuillez réessayer."`, `"signedUrlFailed": "Impossible de générer le lien de téléchargement."`, `"scanNotClean": "Fichier non encore disponible — l'analyse antivirus est en cours ou le fichier a été rejeté."`.
  </action>
  <verify>
    <automated>jq -e '.players.list.title == "Joueurs"' messages/fr.json && jq -e '.files.photo.scanInfected | contains("rejeté")' messages/fr.json && jq -e '.lookups.academy.topsportschool == "Topsportschool"' messages/fr.json && jq -e '.lookups.ageCategory.age_pre_minor == "Préminimes"' messages/fr.json && jq -e '.errors.field.belgianPostalCode | contains("4 chiffres")' messages/fr.json && python3 -c "import json; nl=json.load(open('messages/nl.json')); en=json.load(open('messages/en.json')); fr=json.load(open('messages/fr.json')); assert nl['lookups']['academy']['topsportschool'] == en['lookups']['academy']['topsportschool'] == fr['lookups']['academy']['topsportschool'], 'proper-noun D-45 violation'"</automated>
  </verify>
  <acceptance_criteria>
    - All FR canonical strings from UI-SPEC verbatim
    - Proper-noun rule D-45 honored
    - File is valid JSON
    - python3 sanity check confirms identical academy canonical names across all 3 catalogs
  </acceptance_criteria>
  <done>French catalog at parity.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Create docs/i18n-conventions.md</name>
  <read_first>
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-44, D-45
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Localization Contract
    - messages/nl.json (current shape — as written in Tasks 1-3)
  </read_first>
  <files>
    docs/i18n-conventions.md
  </files>
  <action>
    ```markdown
    # i18n Conventions (nl / en / fr)

    VTTL ships a drietalig (nl/en/fr) UI. Every user-facing string is loaded
    from `messages/{nl,en,fr}.json` via `next-intl`. Source code, pino logs,
    and error codes remain English (I18N-11).

    ## Proper-noun rule (I18N-06, D-45)

    Academy names, club names, person names, tournament event names are
    **canonical** — stored once and rendered IDENTICALLY across all three
    locales. The fr-UI for `Topsportschool Wilrijk` is `Topsportschool
    Wilrijk`, not a translation.

    Mechanism:
    - `academy.canonical_name` column in `src/server/db/schema/lookups.ts`
      is `text NOT NULL`; the value is the canonical string.
    - The i18n catalog keys `lookups.academy.<code>` exist for consistency
      with other lookup categories but their VALUES duplicate the canonical
      name verbatim across nl/en/fr.
    - For person names, `users.name` is the canonical string; UI renders it
      identically in every locale.
    - For free-text club names, the value stored in `players.club` is what
      the UI shows in every locale.

    ## Lookup-label resolver (D-44)

    Lookup tables use language-neutral codes (e.g., `status_a`,
    `age_pre_minor`, `diploma_a_in_training`). Display labels live in
    `messages/{nl,en,fr}.json` under `lookups.<table>.<code>` (PLURAL root
    — Phase 1 established `lookups`, Phase 2 keeps the plural).

    Resolution helpers:

    ```typescript
    // Client (inside a Client Component):
    import { useTranslations } from 'next-intl';
    const t = useTranslations('lookups.academy');
    t('topsportschool')  // → "Topsportschool"

    // Server (inside an RSC):
    import { getTranslations } from 'next-intl/server';
    const t = await getTranslations({ locale, namespace: 'lookups.academy' });
    t('academy_brussel')
    ```

    A small wrapper `useLookupLabel(category, code)` may emerge in Phase 5+
    if multiple call sites repeat this pattern; Phase 2 keeps it inline.

    ## Zod error message → i18n key (I18N-08, D-46)

    Every Zod schema in `src/server/trpc/schemas/*.ts` emits its `message`
    field as an i18n key starting with `errors.` (flat namespace `errors.field.*`
    and `errors.file.*`). The client adapter `src/lib/forms/zod-i18n.ts`
    `useZodErrorMessage()` resolves the key via `useTranslations('errors')`.

    Server-side: tRPC's error formatter (Phase 1) passes the message string
    through unchanged; the calling client renders via the adapter.

    ## Catalog completeness

    All keys MUST exist in all three catalogs. Missing keys in dev render
    as `MISSING_KEY:nl.players.list.title` (D-20 Phase 1 fail-loud fallback).
    The Phase 8 CI gate (I18N-10) will block production deploys with
    missing keys.

    ## Adding a new key

    1. Add the key to `messages/nl.json` first (Dutch is the source language).
    2. Add the matching key to `messages/en.json` and `messages/fr.json` in
       the same PR (parity is enforced manually until I18N-10 ships).
    3. For Zod errors: emit `{ message: 'errors.field.foo' }` in the schema;
       define `errors.field.foo` in all 3 catalogs.
    4. For lookup labels: rule depends on whether the value is a proper noun
       (D-45 — identical across catalogs) or descriptive (translate per locale).

    ## What NOT to do

    - **Never** introduce `display_name_nl` / `display_name_en` / `display_name_fr`
      columns on a lookup table. The proper-noun rule applies to all of them.
    - **Never** hard-code Dutch (or any locale) strings in components.
    - **Never** call `Intl.DateTimeFormat` directly — go through
      `src/lib/i18n-format.ts` (Phase 1) which honors the active locale and
      Belgian conventions (Monday weekstart, dd/MM/yyyy format).
    - **Never** rely on the silent English-fallback in dev for missing keys —
      add the key to all 3 catalogs.
    ```
  </action>
  <verify>
    <automated>test -f docs/i18n-conventions.md && grep -q "I18N-06" docs/i18n-conventions.md && grep -q "I18N-08" docs/i18n-conventions.md && grep -q "D-45" docs/i18n-conventions.md && grep -q "D-46" docs/i18n-conventions.md && grep -q "display_name_nl" docs/i18n-conventions.md</automated>
  </verify>
  <acceptance_criteria>
    - Doc covers proper-noun rule, lookup resolver, Zod-i18n adapter, completeness, and forbidden patterns
    - References Phase 2 decision codes (D-44, D-45, D-46)
    - Explicit "what NOT to do" list
  </acceptance_criteria>
  <done>Future contributors have a single reference for i18n conventions.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User-facing strings ↔ legal consent | Phase 2 strings are informational, not consent-bearing (consent text from Phase 1 unchanged) |
| Proper-noun canonicality ↔ display drift | Mismatched canonical name across catalogs would create the impression of translation (I18N-06 violation) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-11-MISSING-KEY-PROD | Information Disclosure | Production UI shows `MISSING_KEY:nl.errors.field.required` | mitigate | Phase 8 CI gate (I18N-10) blocks deploy; Phase 2 unit test in 02-15 will assert key parity across catalogs |
| T-02-11-WRONG-CANONICAL-NAME | Information Disclosure (minor) | Placeholder academy canonical name reaches production | accept | RESEARCH A1 — TD confirms via UPDATE migration; doc'd as TODO |
| T-02-11-PROPER-NOUN-DRIFT | Information Disclosure | fr.json academy name accidentally translated | mitigate | python3 sanity check in Task 3 verify block enforces equality; CI to be added in Phase 8 |
</threat_model>

<verification>
- All 3 catalogs are valid JSON
- Proper-noun equality across catalogs (Task 3 verify check)
- All keys referenced by UI-SPEC §Copywriting Contract present in all 3 catalogs
- `pnpm exec eslint messages/` passes (json plugin if configured)
</verification>

<success_criteria>
- 3 catalogs updated, ≥50 new keys each
- Phase 1 keys untouched
- Proper-noun rule honored
- Doc page guides future contributors
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-11-SUMMARY.md` listing total new key count per catalog and any A1 placeholder labels.
</output>

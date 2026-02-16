# Photo Assist MVP (Vertex)

This project now includes a photo-based food draft flow in `FoodLogger` and a Supabase Edge Function endpoint at `supabase/functions/process-food-photo/index.ts`.

## What users can do

- Open Nutrition -> Log Entry
- Switch to `Photo`
- Upload/take a meal photo
- Optionally add a text hint (for better accuracy)
- Tap `Analyze Photo`
- Review/edit the suggested food and servings
- Save as a normal nutrition log entry

## Required setup

### 1) Google Cloud / Vertex

- Create or pick a GCP project with Vertex AI enabled.
- Create a service account with Vertex access (Vertex AI User role is usually enough).
- Download the service account JSON key.

### 2) Supabase Edge Function secrets

Set these secrets in your Supabase project:

- `GOOGLE_SERVICE_ACCOUNT_JSON` -> full JSON key as a single string
- `GCP_PROJECT_ID` -> your GCP project id
- `VERTEX_LOCATION` -> optional, defaults to `us-central1`
- `VERTEX_MODEL` -> optional, defaults to `gemini-1.5-flash`

If your project has model access restrictions, set `VERTEX_MODEL` explicitly to a model your project can use.

### 3) Deploy the function

From project root:

```bash
supabase functions deploy process-food-photo
```

For local testing:

```bash
supabase functions serve process-food-photo --env-file .env.local
```

## Notes

- The client never talks to Vertex directly.
- Requests go through Supabase Edge Function and require an authenticated Supabase user.
- Photo drafts are estimates. Final save still uses user confirmation.

## Troubleshooting

If app shows `Edge Function returned a non-2xx status code`:

1. Check function logs in Supabase Dashboard for `process-food-photo`.
2. Confirm required secrets are set:
   - `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `GCP_PROJECT_ID`
3. Re-deploy function after secrets update:

```bash
supabase functions deploy process-food-photo
```

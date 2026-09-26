# Releasing the kit

The kit (spec, recipes, runtime, composer, skills, `template/` and `docs/agents/`) is released as one unit, and
Bicycle Studio vendors **only tagged releases**, never a branch.

## Versions and tags

Tags are `kit-vMAJOR.MINOR.PATCH`, cut from `main`:

| Bump | When | Examples |
| --- | --- | --- |
| MAJOR | a breaking change to a public contract: `spec/dataapp-spec.v*.schema.json`, the app manifest, the host messages (`studio:sandbox:*`), derived query ids or parameter names | removing a spec field, renaming a query id |
| MINOR | additive: a new recipe, family, spec field with a default, SDK function, skill section | `bda.fn` in `template/` (1.1.0) |
| PATCH | docs, fixes, regenerated `docs/agents/` with no contract change | a wording fix, a recipe bug fix |

`package.json` and `template/package.json` carry the same version as the tag.

## Checklist

Every change reaches `main` by a reviewed pull request (this repository is public; nobody pushes to `main`).

1. **CI is green on `main`**: `npm run build`, `npm run check` (includes `evals/diff.mjs`), `node evals/run.mjs`,
   `scripts/no-real-ids.sh`, and the template job (`cd template && npm ci && npm run build && npm test`).
2. **No real ids.** Run `scripts/no-real-ids.sh` with `KIT_FORBIDDEN_IDS` set to the customer model ids and
   tenant names you know of (keep that list out of the repo).
3. **Goldens are current.** `node evals/run.mjs` passes without `--update`; any golden change was reviewed in its PR.
4. **`runtime/dist/` is rebuilt and committed** (`npm run build`): Studio vendors the built files.
5. **`docs/agents/` is regenerated** from Studio's sources, its INDEX stamps the source commits, and it has had a
   content review.
6. **`CHANGELOG.md`**: move `## Unreleased` to `## X.Y.Z`, and bump both `package.json` versions, in a release PR.
7. **Tag** after the release PR merges (a maintainer, not an agent):

   ```bash
   git switch main && git pull
   git tag -a kit-vX.Y.Z -m "kit X.Y.Z"
   git push origin kit-vX.Y.Z
   ```

   Then create a GitHub Release from the tag with the changelog section as its notes.

## After the tag: Studio

In bicycle-studio-api, re-vendor the kit from the tag (never a branch sha). Its `VERSION` file should record the
tag, the commit and the vendoring date, and Studio's MCP (`studio://skill/*`, `dataapp_sdk`) should report the kit
tag, so an agent can tell which kit it is reading. The skills, recipes and SDK Studio serves then match this repository at
that tag.

# Issue tracker: GitHub Issues

Issues and specs for this repo live in GitHub Issues on `rick-sundayai/company_research`. Use the `gh` CLI.

## Issues are public

Anyone can read them. An issue never contains a real Brief, a real Stance or its note, or the Researcher's email. A bug found on real data is reproduced with fictional sample data (see `CONTEXT.md` › Researcher) before it is filed, and the issue describes only the fictional case.

## Conventions

- A spec is one issue labelled `spec`, titled `Spec: <feature>`
- Implementation issues are vertical slices, each linked to its spec issue (as a sub-issue, or with `Part of #<n>` in the body)
- Triage state is a label (see `triage-labels.md` for the strings)
- Conversation happens in issue comments

## When a skill says "publish to the issue tracker"

`gh issue create --repo rick-sundayai/company_research --title "..." --body-file <file> --label <label>`

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --repo rick-sundayai/company_research --comments`

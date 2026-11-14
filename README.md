# GrocerySave code challenge

A multi-task coding challenge for AI models and engineers. The model receives a repository with the
GrocerySave logic removed (a grocery price-comparison app: TypeScript, Express, PostgreSQL, React)
and re-implements it from a written specification, task by task, round by round.

The model works in an Ubuntu VM with no external access.

## What is in this repository

| Path | What it is |
|---|---|
| `starter/` | the repository the model works on: logic modules replaced by stubs that keep signatures and doc comments |
| `starter.tar.gz`, `starter.zip` | the same starter as an archive; the `.tar.gz` and `.zip` contain a `.git` folder with a single commit named "Starter", so the model's work can be diffed with `git diff Starter` |
| `starter/TECH_SPEC.md` | the technical specification the model builds from (back end and client) |
| `TASKS.md` | for the reviewer: task description, how to judge completion, eight tasks and 66 rounds (the message to send at each round, what to look for, grader checkpoints) |
| `vm-selftest.sh` | run inside the VM before the session: checks Node, native binaries, typecheck/lint/build, Postgres |

## Tasks

| # | Area | Rounds |
|---|---|---|
| 1 | Pricing logic: money, list parsing, product matching, comparison | 8 |
| 2 | Optimisation, routing and deal detection | 7 |
| 3 | Mocked supermarket feeds | 9 |
| 4 | API core: app, authentication, lists, import | 8 |
| 5 | API planning, sharing and the server entry point | 11 |
| 6 | Comparison view: formatting, heat colours, CSV export, summary, table | 8 |
| 7 | Plan and route view: map projection, plan cards, offline SVG map | 7 |
| 8 | Lists, deals and settings forms | 8 |

Run the client tasks in the order 6, 7, 8; Task 6 needs Task 1, Tasks 7 and 8 need Tasks 1 and 6.

## Preparing the VM (no network needed)

1. Node.js 20+ and PostgreSQL 13+ in the VM.
2. Unpack the starter: `mkdir grocerysave && tar xzf starter.tar.gz -C grocerysave`.
3. Dependencies: the VM has no network, so build `node_modules` on an Ubuntu machine that does
   (`npm ci` in the starter, then `tar czf node_modules.tar.gz node_modules`), copy it over and
   unpack it into the starter. The model must not run `npm install` or `npm ci`.
4. Two empty, disposable Postgres databases, then export `DATABASE_URL`, `TEST_DATABASE_URL` and
   `JWT_SECRET`.
5. `bash vm-selftest.sh`, then send the Round 1 message of Task 1 from `TASKS.md`.

## License

[MIT](LICENSE)

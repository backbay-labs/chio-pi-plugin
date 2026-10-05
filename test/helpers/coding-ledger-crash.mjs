// Trusted test fixture only: emulate a resource owner killed inside a ledger
// commit. It holds the owner lock like serve, changes committed pages inside one
// SQLite transaction with a tiny cache so SQLite syncs its rollback journal and
// writes uncommitted pages, then dies by SIGKILL before COMMIT.
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {acquireOwnerLock} from "../../dist/coding-resource/paths.js";

const stateRoot = process.argv[2];
await acquireOwnerLock(stateRoot);
const db = new DatabaseSync(join(stateRoot, "ledger.sqlite"));
db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=2; BEGIN IMMEDIATE");
db.prepare("UPDATE metadata SET value=? WHERE key='currentDigest'").run("f".repeat(64));
const insert = db.prepare("INSERT INTO generations(digest,manifest,parent,operation_id) VALUES(?,?,NULL,NULL)");
for (let index = 0; index < 400; index++) insert.run(index.toString(16).padStart(64, "0"), "x".repeat(2000));
db.prepare("UPDATE metadata SET value=? WHERE key='initialDigest'").run("e".repeat(64));
process.kill(process.pid, "SIGKILL");

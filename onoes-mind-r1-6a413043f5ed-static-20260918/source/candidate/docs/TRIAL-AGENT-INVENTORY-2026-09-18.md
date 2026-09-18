# Trial agent inventory and compatibility gap

Read-only inventory. No launch, health request, credentials, configurations or native stores changed.

Root: X:/SANITIZED/LOCAL_PATH Git HEAD: f7bd479580a59c3d1ea78a523917a6cc7050e84a. Tree is dirty: mind_memory.py and worker.py modified; multiple untracked governance/skill/result artifacts. Preserve all of it; this is not an Onoes-Mind implementation target.

The README identifies h/, oc/, p/ as the managed Hermes/OpenClaw/Pi trial directories. Additional hermes-sandbox/, openclaw-sandbox/, pi-sandbox/ directories exist with config, memory, skills, scripts and backup directories. Existence alone does not prove which launcher owns an installed runtime. No .env or key files were opened.

The README requires ONE test agent at a time and shutdown after testing. Preserve that sequencing during real runtime trials; concurrent service tests use synthetic fixtures instead.

MIND_WIRING.md records an August 6 experiment against the older HTTP Mind implementation. mind_memory.py currently references /api/v1/memory/remember, /api/v1/memory/search and promotion routes. Its documented principal names herm/pi/claw differ from current canonical ledger principals. The current canonical bridge is a loopback JSON-line task protocol. The old adapter must not be launched against a guessed endpoint or treated as compatible.

Production mapping supplied by operator: Echo=Hermes on PC; Cyony=Hermes in cloud; Tripp=OpenClaw. All require distinct principal/device/session identities. Onoes-Agent is a separate future client. Pi's simple, coding and kitchen-sink variants are user-described; exact installed variant and capabilities remain to be established.

Before live trials: inspect launch scripts and owning runtime/package versions without executing them; establish sandbox config/session/skill roots without exposing secrets; verify isolated trial identities; implement the common adapter contract against synthetic server fixtures; only then choose one sandbox for an explicitly bounded real run. Existing runnable-looking scripts are not authorization to connect to their previously configured services.

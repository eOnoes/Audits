// Fixed inert child for future separately authorized suspended-creation probes.
// The owning primitive has NO resume API. Unexpected execution exits nonzero;
// it does not open handles, perform IPC, touch files or run task code.
internal static class NeverResumeHostChild {
    static int Main(){return 73;}
}

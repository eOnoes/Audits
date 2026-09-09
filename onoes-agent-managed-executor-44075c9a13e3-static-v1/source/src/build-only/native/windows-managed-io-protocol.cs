// One-shot private inherited-stdio protocol for an already trusted native worker.
// NOT a listener, installer, approval gate or command runner. Synchronous I/O is
// supervised by the OUTER native job; a JS timeout alone is not containment.
using System;
using System.IO;
using System.Text;

internal static class WindowsManagedIoProtocol {
    private const int Header=44, MaxBody=16777216+278;
    private static void Need(bool value) { if(!value) throw new InvalidOperationException("managed-io-protocol-invalid"); }
    private static byte[] ReadExact(Stream input,int count) {
        var bytes=new byte[count]; int at=0;
        while(at<count) { int got=input.Read(bytes,at,count-at); Need(got>0); at+=got; }
        return bytes;
    }
    internal static byte Run(Stream input,Stream output,WindowsManagedWorkspace workspace,byte[] workspaceDigest) {
        Need(workspaceDigest!=null && workspaceDigest.Length==32);
        byte[] head=ReadExact(input,Header), body=null, result=null;
        try {
            Need(Encoding.ASCII.GetString(head,0,4)=="OMI1" && head[4]>=1 && head[4]<=4 && head[5]==0 && head[6]==0 && head[7]==0);
            for(int i=0;i<32;i++) Need(head[12+i]==workspaceDigest[i]);
            uint length=BitConverter.ToUInt32(head,8); Need(length<=MaxBody);
            if(head[4]==4) Need(length<=WindowsManagedWorkspace.ImportBodyMaximum);
            body=ReadExact(input,(int)length); Need(input.ReadByte()==-1); // No trailing request before ANY effect.
            byte op=head[4]; string path=null, digest=null; int maximum=0, payloadOffset=0;
            if(op==1) Need(body.Length==0);
            else if(op!=4) {
                Need(body.Length>=2); int pathLength=BitConverter.ToUInt16(body,0);
                Need(pathLength>0 && pathLength<=240 && body.Length>=2+pathLength);
                for(int i=0;i<pathLength;i++) Need(body[2+i]>=32 && body[2+i]<=126);
                path=Encoding.ASCII.GetString(body,2,pathLength); payloadOffset=2+pathLength;
                if(op==2) {
                    Need(body.Length==payloadOffset+4);
                    uint bound=BitConverter.ToUInt32(body,payloadOffset); Need(bound<=WindowsManagedWorkspace.MaximumFileBytes); maximum=(int)bound;
                } else {
                    Need(body.Length>=payloadOffset+36);
                    digest="sha256:"+BitConverter.ToString(body,payloadOffset,32).Replace("-","").ToLowerInvariant();
                    uint size=BitConverter.ToUInt32(body,payloadOffset+32);
                    Need(size<=WindowsManagedWorkspace.MaximumFileBytes && body.Length==payloadOffset+36+size);
                    payloadOffset+=36;
                }
            }
            byte denied=0;
            try {
                if(op==1) workspace.AssertCustody();
                else if(op==2) result=workspace.ReadFileBytes(path,maximum);
                else if(op==4) workspace.ImportNewFiles(body);
                else {
                    byte[] replacement=new byte[body.Length-payloadOffset];
                    try { Buffer.BlockCopy(body,payloadOffset,replacement,0,replacement.Length); workspace.ReplaceFileBytes(path,digest,replacement); }
                    finally { Array.Clear(replacement,0,replacement.Length); }
                }
            } catch(ManagedIoException) { denied=1; }
            var response=new byte[Header]; Encoding.ASCII.GetBytes("OMR1").CopyTo(response,0);
            response[4]=op; response[5]=denied; BitConverter.GetBytes(result==null ? 0 : result.Length).CopyTo(response,8);
            workspaceDigest.CopyTo(response,12); output.Write(response,0,response.Length);
            if(result!=null) output.Write(result,0,result.Length);
            output.Flush(); // Caller still must observe actual worker EXIT before settlement.
            return op;
        } finally {
            if(body!=null) Array.Clear(body,0,body.Length);
            if(result!=null) Array.Clear(result,0,result.Length);
        }
    }

    // Persistent private inherited-stdio protocol for one executor operation.
    // The caller keeps exactly one request in flight. The workspace object (and
    // therefore its exclusive root lock plus retained ancestor handles) lives
    // until stdin EOF, not merely until one read/replace response is flushed.
    internal static void RunSession(Stream input,Stream output,WindowsManagedWorkspace workspace,byte[] workspaceDigest,Action<byte> afterResponse=null) {
        const int SessionHeader=48; uint priorSequence=0;
        Need(workspaceDigest!=null && workspaceDigest.Length==32);
        while(true) {
            int first=input.ReadByte(); if(first==-1)return;
            byte[] head=new byte[SessionHeader],body=null,result=null;head[0]=(byte)first;
            try {
                byte[] rest=ReadExact(input,SessionHeader-1);Buffer.BlockCopy(rest,0,head,1,rest.Length);Array.Clear(rest,0,rest.Length);
                Need(Encoding.ASCII.GetString(head,0,4)=="OMI2" && head[4]>=1 && head[4]<=3
                    && head[5]==0 && head[6]==0 && head[7]==0);
                uint sequence=BitConverter.ToUInt32(head,8);Need(sequence==priorSequence+1 && sequence!=0);priorSequence=sequence;
                uint length=BitConverter.ToUInt32(head,12);Need(length<=MaxBody);
                for(int i=0;i<32;i++)Need(head[16+i]==workspaceDigest[i]);
                body=ReadExact(input,(int)length);
                byte op=head[4];string path=null,digest=null;int maximum=0,payloadOffset=0;
                if(op==1)Need(body.Length==0);
                else {
                    Need(body.Length>=2);int pathLength=BitConverter.ToUInt16(body,0);
                    Need(pathLength>0&&pathLength<=240&&body.Length>=2+pathLength);
                    for(int i=0;i<pathLength;i++)Need(body[2+i]>=32&&body[2+i]<=126);
                    path=Encoding.ASCII.GetString(body,2,pathLength);payloadOffset=2+pathLength;
                    if(op==2) {
                        Need(body.Length==payloadOffset+4);uint bound=BitConverter.ToUInt32(body,payloadOffset);
                        Need(bound<=WindowsManagedWorkspace.MaximumFileBytes);maximum=(int)bound;
                    } else {
                        Need(body.Length>=payloadOffset+36);
                        digest="sha256:"+BitConverter.ToString(body,payloadOffset,32).Replace("-","").ToLowerInvariant();
                        uint size=BitConverter.ToUInt32(body,payloadOffset+32);
                        Need(size<=WindowsManagedWorkspace.MaximumFileBytes&&body.Length==payloadOffset+36+size);payloadOffset+=36;
                    }
                }
                byte denied=0;
                try {
                    if(op==1)workspace.AssertCustody();
                    else if(op==2)result=workspace.ReadFileBytes(path,maximum);
                    else {
                        byte[] replacement=new byte[body.Length-payloadOffset];
                        try {Buffer.BlockCopy(body,payloadOffset,replacement,0,replacement.Length);workspace.ReplaceFileBytes(path,digest,replacement);}
                        finally {Array.Clear(replacement,0,replacement.Length);}
                    }
                } catch(ManagedIoException) {denied=1;}
                var response=new byte[SessionHeader];Encoding.ASCII.GetBytes("OMR2").CopyTo(response,0);
                response[4]=op;response[5]=denied;BitConverter.GetBytes(sequence).CopyTo(response,8);
                BitConverter.GetBytes(result==null?0:result.Length).CopyTo(response,12);workspaceDigest.CopyTo(response,16);
                output.Write(response,0,response.Length);if(result!=null)output.Write(result,0,result.Length);output.Flush();
                if(afterResponse!=null)afterResponse(op);
            } finally {
                Array.Clear(head,0,head.Length);if(body!=null)Array.Clear(body,0,body.Length);if(result!=null)Array.Clear(result,0,result.Length);
            }
        }
    }
}

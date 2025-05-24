import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import socket from "../socket";

interface IncomingCall {
  offer: RTCSessionDescriptionInit;
  caller: {
    id: string;
    firstName: string;
  };
  isVideo: boolean;
}

const Chat = () => {
  const { partnerId } = useParams();
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "incoming" | "ongoing">("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStreamEnabled, setLocalStreamEnabled] = useState({ audio: true, video: true });

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // Add a ref for messages container to scroll it
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const servers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  };

  useEffect(() => {
    if (!currentUser?.id || !partnerId) return;

    socket.emit("join_chat_room", { user1Id: currentUser.id, user2Id: partnerId });

    const fetchMessages = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/v1/messages/${currentUser.id}/${partnerId}`);
        const data = await res.json();
        setMessages(data);
      } catch (err) {
        console.error("Error fetching messages:", err);
      }
    };

    const fetchPartner = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/v1/users/${partnerId}`);
        const data = await res.json();
        setUser(data?.data);
      } catch (err) {
        console.error("Error fetching partner:", err);
      }
    };

    fetchMessages();
    fetchPartner();

    const handleReceiveMessage = (msg: any) => setMessages((prev) => [...prev, msg]);

    const handleReceiveCall = ({ offer, caller, isVideo }: IncomingCall) => {
      setCallStatus("incoming");
      setIncomingCall({ offer, caller, isVideo });
    };

    const handleCallAnswered = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      try {
        if (!peerConnectionRef.current) return;
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus("ongoing");
      } catch (err) {
        console.error("Remote description error:", err);
        endCall();
      }
    };

    const handleIceCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        if (candidate && peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error("ICE error:", err);
      }
    };

    const handleCallEnded = () => endCall();

    socket.on("receive_message", handleReceiveMessage);
    socket.on("receive_call", handleReceiveCall);
    socket.on("call_answered", handleCallAnswered);
    socket.on("ice_candidate", handleIceCandidate);
    socket.on("call_ended", handleCallEnded);

    return () => {
      socket.off("receive_message", handleReceiveMessage);
      socket.off("receive_call", handleReceiveCall);
      socket.off("call_answered", handleCallAnswered);
      socket.off("ice_candidate", handleIceCandidate);
      socket.off("call_ended", handleCallEnded);
      endCall();
    };
  }, [currentUser?.id, partnerId]);

  // Auto scroll effect: scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !partnerId) return;

    const messageData = {
      senderId: currentUser.id,
      reciverId: partnerId,
      content: input,
    };

    socket.emit("send_message", messageData);
    setInput("");
  };

  const startCall = async (isVideo: boolean) => {
    try {
      setCallStatus("calling");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(servers);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("ice_candidate", {
            targetUserId: partnerId,
            candidate: e.candidate,
          });
        }
      };

      pc.ontrack = (e) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") endCall();
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("call_user", {
        calleeId: partnerId,
        offer,
        caller: currentUser,
        isVideo,
      });
    } catch (err) {
      console.error("Start call error:", err);
      alert("Could not start the call. Check mic/cam permissions.");
      endCall();
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incomingCall.isVideo });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(servers);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("ice_candidate", {
            targetUserId: incomingCall.caller.id,
            candidate: e.candidate,
          });
        }
      };

      pc.ontrack = (e) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") endCall();
      };

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer_call", {
        callerId: incomingCall.caller.id,
        answer,
      });

      setCallStatus("ongoing");
      setIncomingCall(null);
    } catch (err) {
      console.error("Accept call error:", err);
      endCall();
    }
  };

  const rejectCall = () => {
    if (incomingCall) {
      socket.emit("reject_call", { callerId: incomingCall.caller.id });
      setIncomingCall(null);
      setCallStatus("idle");
    }
  };

  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    if ((callStatus === "ongoing" || callStatus === "calling") && partnerId) {
      socket.emit("end_call", { partnerId });
    }

    setCallStatus("idle");
    setIncomingCall(null);
  };

  const toggleMedia = (type: "audio" | "video") => {
    if (!localStreamRef.current) return;
    const newState = !localStreamEnabled[type];
    setLocalStreamEnabled(prev => ({ ...prev, [type]: newState }));
    localStreamRef.current.getTracks()
      .filter(track => track.kind === type)
      .forEach(track => (track.enabled = newState));
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-green-600 text-white px-6 py-4 flex items-center gap-3 shadow">
        <div className="w-10 h-10 bg-white text-green-600 font-bold rounded-full flex items-center justify-center">
          {user?.firstName?.[0]}
        </div>
        <h2 className="text-lg font-semibold">{user?.firstName}</h2>
        <div className="ml-auto flex gap-2">
          <button onClick={() => startCall(true)} className="bg-white text-green-600 px-4 py-1 rounded" disabled={callStatus !== "idle"}>Video Call</button>
          <button onClick={() => startCall(false)} className="bg-white text-green-600 px-4 py-1 rounded" disabled={callStatus !== "idle"}>Audio Call</button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-2 space-y-2"
        style={{ scrollBehavior: "smooth" }}
      >
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.senderId === currentUser.id ? "justify-end" : "justify-start"}`}>
            <div className={`rounded-lg px-4 py-2 max-w-xs text-sm ${msg.senderId === currentUser.id ? "bg-green-500 text-white" : "bg-white text-gray-900 shadow"}`}>
              {msg.content}
            </div>
          </div>
        ))}
        {/* Dummy div to scroll into view */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-2 bg-white flex items-center gap-2 border-t">
        <input type="text" className="flex-1 px-3 py-2 border rounded" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder="Type a message" />
        <button onClick={sendMessage} className="bg-green-600 text-white px-4 py-2 rounded">Send</button>
      </div>

      {/* Incoming call modal */}
      {callStatus === "incoming" && incomingCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full text-center">
            <h3 className="text-lg font-semibold mb-4">{incomingCall.caller.firstName} is calling you {incomingCall.isVideo ? "with video" : "with audio"}</h3>
            <div className="flex justify-center gap-4">
              <button onClick={acceptCall} className="bg-green-600 text-white px-4 py-2 rounded">Accept</button>
              <button onClick={rejectCall} className="bg-red-600 text-white px-4 py-2 rounded">Reject</button>
            </div>
          </div>
        </div>
      )}

      {/* Call ongoing UI */}
      {(callStatus === "ongoing" || callStatus === "calling") && (
        <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-4 flex flex-col gap-2 z-40">
          <div className="flex gap-2">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-24 h-24 bg-black rounded" />
            <video ref={remoteVideoRef} autoPlay playsInline className="w-48 h-48 bg-black rounded" />
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={() => toggleMedia("audio")} className={`px-3 py-1 rounded ${localStreamEnabled.audio ? "bg-green-600 text-white" : "bg-gray-300"}`}>
              {localStreamEnabled.audio ? "Mute Mic" : "Unmute Mic"}
            </button>
            <button onClick={() => toggleMedia("video")} className={`px-3 py-1 rounded ${localStreamEnabled.video ? "bg-green-600 text-white" : "bg-gray-300"}`}>
              {localStreamEnabled.video ? "Stop Video" : "Start Video"}
            </button>
            <button onClick={endCall} className="px-3 py-1 rounded bg-red-600 text-white">End Call</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;

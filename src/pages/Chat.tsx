import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import socket from "../socket"; // Your socket.io client instance
import { FiMoreVertical, FiSearch, FiPaperclip, FiMic, FiSmile } from "react-icons/fi";
import { IoCall, IoVideocam } from "react-icons/io5";
import { BiArrowBack } from "react-icons/bi";

interface IncomingCall {
  offer: RTCSessionDescriptionInit;
  caller: {
    id: string;
    firstName: string;
  };
  isVideo: boolean;
}

// Create audio objects for ringtones
const incomingRingtone = new Audio('/sounds/incoming-call.mp3');
const outgoingRingtone = new Audio('/sounds/outgoing-call.mp3');
incomingRingtone.loop = true;
outgoingRingtone.loop = true;

const Chat = () => {
  const { partnerId } = useParams();
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "ringing" | "incoming" | "ongoing">("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStreamEnabled, setLocalStreamEnabled] = useState({ audio: true, video: true });

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const servers = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  useEffect(() => {
    if (!currentUser?.id || !partnerId) return;

    socket.emit("join_chat_room", { user1Id: currentUser.id, user2Id: partnerId });

    const fetchMessages = async () => {
      const res = await fetch(`http://localhost:5000/api/v1/messages/${currentUser.id}/${partnerId}`);
      const data = await res.json();
      setMessages(data);
    };

    const fetchPartner = async () => {
      const res = await fetch(`http://localhost:5000/api/v1/users/${partnerId}`);
      const data = await res.json();
      setUser(data?.data);
    };

    fetchMessages();
    fetchPartner();

    const handleReceiveMessage = (msg: any) => setMessages(prev => [...prev, msg]);
    const handleReceiveCall = ({ offer, caller, isVideo }: IncomingCall) => {
      setCallStatus("incoming");
      setIncomingCall({ offer, caller, isVideo });
      incomingRingtone.play(); // Play incoming ringtone
    };

    const handleCallAnswered = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnectionRef.current) return;
      outgoingRingtone.pause(); // Stop outgoing ringtone when answered
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      setCallStatus("ongoing");
    };

    const handleIceCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      if (candidate && peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const handleCallEnded = () => {
      incomingRingtone.pause();
      outgoingRingtone.pause();
      endCall();
    };

    const handleCallRejected = () => {
      outgoingRingtone.pause();
      setCallStatus("idle");
      alert("Call rejected");
    };

    socket.on("receive_message", handleReceiveMessage);
    socket.on("receive_call", handleReceiveCall);
    socket.on("call_answered", handleCallAnswered);
    socket.on("ice_candidate", handleIceCandidate);
    socket.on("call_ended", handleCallEnded);
    socket.on("call_rejected", handleCallRejected);

    return () => {
      socket.off("receive_message", handleReceiveMessage);
      socket.off("receive_call", handleReceiveCall);
      socket.off("call_answered", handleCallAnswered);
      socket.off("ice_candidate", handleIceCandidate);
      socket.off("call_ended", handleCallEnded);
      socket.off("call_rejected", handleCallRejected);
      incomingRingtone.pause();
      outgoingRingtone.pause();
      endCall();
    };
  }, [currentUser?.id, partnerId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const msg = { senderId: currentUser.id, reciverId: partnerId, content: input };
    socket.emit("send_message", msg);
    setInput("");
  };

  const startCall = async (isVideo: boolean) => {
    try {
      setCallStatus("calling");
      outgoingRingtone.play(); // Play outgoing ringtone
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(servers);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.onicecandidate = e => {
        if (e.candidate) socket.emit("ice_candidate", { targetUserId: partnerId, candidate: e.candidate });
      };
      pc.ontrack = e => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (["disconnected", "failed"].includes(pc.connectionState)) endCall();
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call_user", { calleeId: partnerId, offer, caller: currentUser, isVideo });
    } catch (err) {
      console.error("Call error:", err);
      outgoingRingtone.pause();
      endCall();
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    incomingRingtone.pause(); // Stop incoming ringtone when answered
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incomingCall.isVideo });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection(servers);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      pc.onicecandidate = e => {
        if (e.candidate) socket.emit("ice_candidate", { targetUserId: incomingCall.caller.id, candidate: e.candidate });
      };
      pc.ontrack = e => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (["disconnected", "failed"].includes(pc.connectionState)) endCall();
      };

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer_call", { callerId: incomingCall.caller.id, answer });

      setCallStatus("ongoing");
      setIncomingCall(null);
    } catch (err) {
      console.error("Accept call error:", err);
      endCall();
    }
  };

  const rejectCall = () => {
    incomingRingtone.pause(); // Stop incoming ringtone when rejected
    if (incomingCall) {
      socket.emit("reject_call", { callerId: incomingCall.caller.id });
      setIncomingCall(null);
      setCallStatus("idle");
    }
  };

  const endCall = () => {
    incomingRingtone.pause();
    outgoingRingtone.pause();
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (["ongoing", "calling"].includes(callStatus) && partnerId) {
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
      <div className="bg-emerald-700 text-white px-4 py-3 flex items-center gap-3 shadow">
        <button className="md:hidden">
          <BiArrowBack size={20} />
        </button>
        <div className="w-10 h-10 bg-white text-emerald-700 font-bold rounded-full flex items-center justify-center">
          {user?.firstName?.[0]}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{user?.firstName}</h2>
          <p className="text-xs text-gray-200">
            {callStatus === "ongoing" ? "On call" : "Online"}
          </p>
        </div>
        <div className="flex gap-4 text-white">
          <button onClick={() => startCall(false)} disabled={callStatus !== "idle"}>
            <IoCall size={20} />
          </button>
          <button onClick={() => startCall(true)} disabled={callStatus !== "idle"}>
            <IoVideocam size={20} />
          </button>
          <button>
            <FiSearch size={20} />
          </button>
          <button>
            <FiMoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div 
        className="flex-1 overflow-y-auto px-4 py-2 space-y-2 bg-[#e5ded8]"
        style={{ backgroundImage: "url('https://web.whatsapp.com/img/bg-chat-tile-light_a4be512e7195b6b733d9110b408f075d.png')" }}
      >
        {messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`flex ${msg.senderId === currentUser.id ? "justify-end" : "justify-start"}`}
          >
            <div 
              className={`rounded-lg px-3 py-2 max-w-xs md:max-w-md text-sm ${msg.senderId === currentUser.id 
                ? "bg-emerald-100 text-gray-900 rounded-tr-none" 
                : "bg-white text-gray-900 rounded-tl-none"}`}
            >
              {msg.content}
              <div className={`text-xs mt-1 text-right ${msg.senderId === currentUser.id ? "text-emerald-800" : "text-gray-500"}`}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 bg-gray-100 flex items-center gap-2">
        <button className="text-gray-500 hover:text-gray-700">
          <FiSmile size={24} />
        </button>
        <button className="text-gray-500 hover:text-gray-700">
          <FiPaperclip size={24} />
        </button>
        <input 
          type="text" 
          className="flex-1 px-4 py-2 rounded-full bg-white border-none focus:outline-none" 
          value={input} 
          onChange={e => setInput(e.target.value)} 
          onKeyDown={e => e.key === "Enter" && sendMessage()} 
          placeholder="Type a message" 
        />
        <button 
          onClick={sendMessage} 
          className="bg-emerald-700 text-white p-2 rounded-full"
          disabled={!input.trim()}
        >
          {input.trim() ? (
            <svg viewBox="0 0 24 24" width="24" height="24" className="text-white">
              <path fill="currentColor" d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"></path>
            </svg>
          ) : (
            <FiMic size={24} />
          )}
        </button>
      </div>

      {/* Video Call UI */}
      {(callStatus === "calling" || callStatus === "ongoing") && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center z-50 p-4">
          <div className="flex gap-4 mb-4">
            <video 
              ref={localVideoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-32 h-24 bg-gray-800 rounded-lg absolute bottom-4 right-4" 
            />
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full max-w-4xl max-h-[80vh] bg-gray-900 rounded-lg" 
            />
          </div>
          <div className="text-white mb-4 text-center">
            {callStatus === "calling" && (
              <div className="text-xl animate-pulse">Calling {user?.firstName}...</div>
            )}
            {callStatus === "ongoing" && (
              <div className="text-xl">{user?.firstName}</div>
            )}
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => toggleMedia("audio")} 
              className={`p-3 rounded-full ${localStreamEnabled.audio ? "bg-white" : "bg-red-500 text-white"}`}
            >
              {localStreamEnabled.audio ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" y1="19" x2="12" y2="23"></line>
                  <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                  <line x1="12" y1="19" x2="12" y2="23"></line>
                  <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
              )}
            </button>
            <button 
              onClick={() => toggleMedia("video")} 
              className={`p-3 rounded-full ${localStreamEnabled.video ? "bg-white" : "bg-red-500 text-white"}`}
            >
              {localStreamEnabled.video ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                  <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 2h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 0 1-5.66-5.66"></path>
                </svg>
              )}
            </button>
            <button 
              onClick={endCall} 
              className="bg-red-600 text-white p-3 rounded-full"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
                <line x1="23" y1="1" x2="1" y2="23"></line>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Incoming Call Modal */}
      {callStatus === "incoming" && incomingCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 shadow-lg text-center w-full max-w-sm">
            <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="text-emerald-700 text-3xl font-bold">
                {incomingCall.caller.firstName?.[0]}
              </div>
            </div>
            <h2 className="text-2xl font-semibold mb-2">{incomingCall.caller.firstName}</h2>
            <p className="mb-6 text-gray-600">{incomingCall.isVideo ? "Video Call" : "Voice Call"}</p>
            <p className="mb-6 text-gray-500 animate-pulse">Incoming call...</p>
            <div className="flex justify-center gap-4">
              <button 
                onClick={rejectCall} 
                className="bg-red-600 text-white p-3 rounded-full"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
                  <line x1="23" y1="1" x2="1" y2="23"></line>
                </svg>
              </button>
              <button 
                onClick={acceptCall} 
                className="bg-emerald-600 text-white p-3 rounded-full"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
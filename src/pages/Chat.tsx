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

  const servers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // Add your TURN servers here if needed for NAT traversal
    ],
  };

  // Initialize socket listeners and fetch data
  useEffect(() => {
    if (!currentUser?.id || !partnerId) return;

    socket.emit("join_chat_room", {
      user1Id: currentUser.id,
      user2Id: partnerId,
    });

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

    // Chat message listener
    const handleReceiveMessage = (msg: any) => setMessages((prev) => [...prev, msg]);
    socket.on("receive_message", handleReceiveMessage);

    // WebRTC listeners
    const handleReceiveCall = ({ offer, caller, isVideo }: IncomingCall) => {
      setCallStatus("incoming");
      setIncomingCall({ offer, caller, isVideo });
    };

    const handleCallAnswered = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      try {
        if (!peerConnectionRef.current) {
          throw new Error("Peer connection not established");
        }
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus("ongoing");
      } catch (err) {
        console.error("Error setting remote description:", err);
        endCall();
      }
    };

    const handleIceCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        if (candidate && peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error("Error adding ICE candidate:", err);
      }
    };

    const handleCallEnded = () => {
      endCall();
    };

    socket.on("receive_call", handleReceiveCall);
    socket.on("call_answered", handleCallAnswered);
    socket.on("ice_candidate", handleIceCandidate);
    socket.on("call_ended", handleCallEnded);

    return () => {
      // Cleanup
      socket.off("receive_message", handleReceiveMessage);
      socket.off("receive_call", handleReceiveCall);
      socket.off("call_answered", handleCallAnswered);
      socket.off("ice_candidate", handleIceCandidate);
      socket.off("call_ended", handleCallEnded);
      endCall();
    };
  }, [currentUser?.id, partnerId]);

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

  const startCall = async (isVideo: boolean = true) => {
    if (!partnerId) return;

    try {
      setCallStatus("calling");
      
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo,
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // Create peer connection
      const pc = new RTCPeerConnection(servers);
      peerConnectionRef.current = pc;

      // Add tracks to connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // ICE candidate handler
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("ice_candidate", {
            targetUserId: partnerId,
            candidate: e.candidate,
          });
        }
      };

      // Remote stream handler
      pc.ontrack = (e) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };

      // Connection state change handler
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          endCall();
        }
      };

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("call_user", {
        calleeId: partnerId,
        offer,
        caller: currentUser,
        isVideo,
      });

    } catch (err) {
      console.error("Error starting call:", err);
      endCall();
      alert("Failed to start call. Please check your microphone and camera permissions.");
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;

    try {
      setCallStatus("ongoing");
      
      // Get user media with the same constraints as the caller
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingCall.isVideo,
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // Create peer connection
      const pc = new RTCPeerConnection(servers);
      peerConnectionRef.current = pc;

      // Add tracks to connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // ICE candidate handler
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("ice_candidate", {
            targetUserId: incomingCall.caller.id,
            candidate: e.candidate,
          });
        }
      };

      // Remote stream handler
      pc.ontrack = (e) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };

      // Connection state change handler
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          endCall();
        }
      };

      // Set remote description and create answer
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer_call", {
        callerId: incomingCall.caller.id,
        answer,
      });

      setIncomingCall(null);
    } catch (err) {
      console.error("Error accepting call:", err);
      endCall();
    }
  };

  const rejectCall = () => {
    if (!incomingCall) return;
    
    socket.emit("reject_call", { callerId: incomingCall.caller.id });
    setIncomingCall(null);
    setCallStatus("idle");
  };

  const endCall = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    
    setCallStatus("idle");
    setIncomingCall(null);
    
    // Notify the other peer if we're the one ending the call
    if ((callStatus === "ongoing" || callStatus === "calling") && partnerId) {
      socket.emit("end_call", { partnerId });
    }
  };

  const toggleMedia = (type: "audio" | "video") => {
    if (!localStreamRef.current) return;
    
    const newState = !localStreamEnabled[type];
    setLocalStreamEnabled(prev => ({ ...prev, [type]: newState }));
    
    localStreamRef.current.getTracks()
      .filter(track => track.kind === type)
      .forEach(track => track.enabled = newState);
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
          <button 
            onClick={() => startCall(true)} 
            className="bg-white text-green-600 px-4 py-1 rounded flex items-center gap-1"
            disabled={callStatus !== "idle"}
          >
            <span>Video Call</span>
          </button>
          <button 
            onClick={() => startCall(false)} 
            className="bg-white text-green-600 px-4 py-1 rounded flex items-center gap-1"
            disabled={callStatus !== "idle"}
          >
            <span>Audio Call</span>
          </button>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.senderId === currentUser.id ? "justify-end" : "justify-start"}`}>
            <div className={`rounded-lg px-4 py-2 max-w-xs text-sm ${
              msg.senderId === currentUser.id ? "bg-green-500 text-white" : "bg-white text-gray-900 shadow"
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Message input */}
      <div className="px-4 py-2 bg-white flex items-center gap-2 border-t">
        <input
          type="text"
          placeholder="Type a message..."
          className="flex-1 border rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-400"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button
          className="bg-green-500 text-white px-4 py-2 rounded-full font-medium"
          onClick={sendMessage}
        >
          Send
        </button>
      </div>

      {/* Incoming call modal */}
      {callStatus === "incoming" && incomingCall && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-md text-center">
            <h2 className="text-lg font-bold mb-4">
              Incoming {incomingCall.isVideo ? "video" : "audio"} call from {incomingCall.caller.firstName}
            </h2>
            <div className="flex justify-center gap-4">
              <button
                onClick={acceptCall}
                className="bg-green-500 text-white px-4 py-2 rounded"
              >
                Accept
              </button>
              <button
                onClick={rejectCall}
                className="bg-red-500 text-white px-4 py-2 rounded"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ongoing call controls */}
      {(callStatus === "ongoing" || callStatus === "calling") && (
        <div className="fixed bottom-4 right-4 bg-black p-2 rounded-lg z-50 flex gap-2">
          {localStreamRef.current?.getVideoTracks().length ? (
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              className="w-32 h-32 rounded"
            />
          ) : (
            <div className="w-32 h-32 bg-gray-700 rounded flex items-center justify-center text-white">
              Audio only
            </div>
          )}
          
          <video 
            ref={remoteVideoRef} 
            autoPlay 
            className="w-32 h-32 rounded bg-black"
          />
          
          <div className="flex flex-col gap-1 justify-end">
            <button
              onClick={() => toggleMedia("audio")}
              className={`p-1 rounded ${localStreamEnabled.audio ? "bg-green-500" : "bg-red-500"} text-white`}
            >
              {localStreamEnabled.audio ? "Mute" : "Unmute"}
            </button>
            {localStreamRef.current?.getVideoTracks().length && (
              <button
                onClick={() => toggleMedia("video")}
                className={`p-1 rounded ${localStreamEnabled.video ? "bg-green-500" : "bg-red-500"} text-white`}
              >
                {localStreamEnabled.video ? "Video Off" : "Video On"}
              </button>
            )}
            <button
              onClick={endCall}
              className="bg-red-500 text-white p-1 rounded"
            >
              End
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
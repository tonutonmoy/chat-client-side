import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import socket from "../socket"; // Your socket.io client instance
import axios from "axios"; // For file uploads
import EmojiPicker, { EmojiClickData } from "emoji-picker-react"; // Emoji picker
// Added FiSquare for stop icon
import { FiMoreVertical, FiSearch, FiPaperclip, FiMic, FiSmile, FiSend, FiSquare } from "react-icons/fi";
import { IoCall, IoVideocam } from "react-icons/io5";
import { BiArrowBack } from "react-icons/bi";
import { FaFileAlt } from "react-icons/fa"; // For file icon

interface IncomingCall {
  offer: RTCSessionDescriptionInit;
  caller: {
    id: string;
    firstName: string;
  };
  isVideo: boolean;
}

interface Message {
  id?: string;
  senderId: string;
  reciverId: string;
  content: string;
  createdAt: string;
  type: "text" | "image" | "file" | "audio"; // Added audio
  fileName?: string;
  duration?: number; // Optional: for audio/video duration
}

const incomingRingtone = new Audio('/sounds/incoming-call.mp3');
const outgoingRingtone = new Audio('/sounds/outgoing-call.mp3');
incomingRingtone.loop = true;
outgoingRingtone.loop = true;

const Chat = () => {
  const { partnerId } = useParams<{ partnerId: string }>();
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "ringing" | "incoming" | "ongoing">("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStreamEnabled, setLocalStreamEnabled] = useState({ audio: true, video: true });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false); // Now also for audio uploads

  // --- Voice Recording State ---
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  // --- End Voice Recording State ---

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null); // Also used for voice recording stream
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // --- Voice Recording Refs ---
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
   // --- End Voice Recording Refs ---


  const servers = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  useEffect(() => {
    // ... (existing useEffect for setup and socket listeners - no change here) ...
    // Ensure cleanup for recording related things if component unmounts while recording
    return () => {
        // ... existing cleanup ...
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
        if (localStreamRef.current && isRecording) { // If the stream was only for recording
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
        }
    };
  }, [currentUser?.id, partnerId, isRecording]); // Added isRecording as a dependency for cleanup logic

  // ... (fetchMessages, fetchPartner, socket event handlers, scrollIntoView, clickOutside for emoji) ...
  // These existing useEffects and handlers remain largely the same.
  // The handleReceiveMessage will now correctly type incoming audio messages if the backend sends `type: 'audio'`.


  // --- Modified useEffects and Handlers ---
  useEffect(() => {
    if (!currentUser?.id || !partnerId) return;

    socket.emit("join_chat_room", { user1Id: currentUser.id, user2Id: partnerId });

    const fetchMessages = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/v1/messages/${currentUser.id}/${partnerId}`);
        if (!res.ok) throw new Error('Failed to fetch messages');
        const data = await res.json();
        const typedMessages = data.map((msg: any) => ({
          ...msg,
          type: msg.type || 'text', 
        }));
        setMessages(typedMessages);
      } catch (error) {
        console.error("Error fetching messages:", error);
      }
    };

    const fetchPartner = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/v1/users/${partnerId}`);
        if (!res.ok) throw new Error('Failed to fetch partner details');
        const data = await res.json();
        setUser(data?.data);
      } catch (error) {
        console.error("Error fetching partner:", error);
      }
    };

    fetchMessages();
    fetchPartner();

    const handleReceiveMessage = (msg: Message) => {
      setMessages(prev => [...prev, { ...msg, type: msg.type || 'text' }]);
    };
    const handleReceiveCall = ({ offer, caller, isVideo }: IncomingCall) => {
      setCallStatus("incoming");
      setIncomingCall({ offer, caller, isVideo });
      incomingRingtone.play().catch(e => console.warn("Incoming ringtone play failed:", e));
    };

    const handleCallAnswered = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnectionRef.current) return;
      outgoingRingtone.pause();
      await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      setCallStatus("ongoing");
    };

    const handleIceCandidate = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      if (candidate && peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding ICE candidate:", e);
        }
      }
    };

    const handleCallEnded = () => {
      incomingRingtone.pause();
      outgoingRingtone.pause();
      endCall(true); // Pass true to indicate it's a call-related stream closure
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
      endCall(true); // Pass true for call-related cleanup
       // Recording specific cleanup
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop(); // This will trigger onstop
      }
       // If localStreamRef was used for recording, it might need cleanup here too
       // However, it's better handled in stopRecording or component unmount.
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [currentUser?.id, partnerId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);
  // --- End Modified useEffects and Handlers ---


  const sendMessage = () => {
    if (!input.trim() || isRecording) return; // Don't send if recording
    const msg: Message = {
      senderId: currentUser.id,
      reciverId: partnerId!,
      content: input,
      createdAt: new Date().toISOString(),
      type: "text",
    };
    socket.emit("send_message", msg);
    setMessages(prev => [...prev, msg]);
    setInput("");
    setShowEmojiPicker(false);
  };

  // Generic file upload and message sending function
  const uploadAndSendFile = async (file: File, type: "image" | "file" | "audio") => {
    setUploadingFile(true);
    const formData = new FormData();
    formData.append("upload", file);

    try {
      const res = await axios.post("http://localhost:5000/api/v1/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      console.log(res.data.url)
      const { url, fileName: returnedFileName } = res.data;
      const fileMsg: Message = {
        senderId: currentUser.id,
        reciverId: partnerId!,
        content: url,
        createdAt: new Date().toISOString(),
        type: type,
        fileName: returnedFileName || file.name,
        // duration: type === 'audio' ? recordingDuration : undefined // Add if duration is calculated
      };
      socket.emit("send_message", fileMsg);
      setMessages(prev => [...prev, fileMsg]);
    } catch (error) {
      console.error(`${type} upload error:`, error);
      alert(`${type} upload failed. Please try again.`);
    } finally {
      setUploadingFile(false);
      if (type !== 'audio' && fileInputRef.current) { // Don't reset for audio, it's not from this input
        fileInputRef.current.value = "";
      }
    }
  };


  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileType = file.type.startsWith("image/") ? "image" : "file";
    uploadAndSendFile(file, fileType);
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setInput(prevInput => prevInput + emojiData.emoji);
  };

  // --- Voice Recording Functions ---
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartRecording = async () => {
    if (isRecording || callStatus !== 'idle') return; // Prevent recording if already or in call

    try {
      // Use existing localStreamRef if call is ongoing and audio is enabled,
      // otherwise get a new stream specifically for recording.
      // For simplicity now, always get a new stream for recording unless one is already active from a call.
      // This example focuses on recording when NOT in a call.
      // If you want to record call audio, that's a different, more complex scenario.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream; // Store the stream if it's specifically for recording
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      setRecordingDuration(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      audioChunksRef.current = [];
      const options = { mimeType: 'audio/webm;codecs=opus' }; // Specify preferred mimeType
      let currentMediaRecorder: MediaRecorder;
      try {
        currentMediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        console.warn("Preferred mimeType failed, trying default:", e);
        currentMediaRecorder = new MediaRecorder(stream); // Fallback to default
      }
      mediaRecorderRef.current = currentMediaRecorder;

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
        const audioFile = new File([audioBlob], `voice-message-${Date.now()}.webm`, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
        uploadAndSendFile(audioFile, "audio");
        audioChunksRef.current = [];

        // Stop the tracks of the stream obtained specifically for recording
        if (localStreamRef.current && !peerConnectionRef.current) { // Only stop if not part of an active call stream
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
      };

      mediaRecorderRef.current.start();

    } catch (err) {
      console.error("Error starting recording:", err);
      alert("Could not start recording. Please ensure microphone access is allowed.");
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setRecordingDuration(0);
      setRecordingStartTime(null);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop(); // This will trigger the 'onstop' event
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      // Stream cleanup is handled in onstop if it was a recording-specific stream
    }
  };
  // --- End Voice Recording Functions ---

  // --- WebRTC Call Functions (startCall, acceptCall, rejectCall, endCall, toggleMedia) ---
  // Modified endCall to accept a flag
  const endCall = (isCallRelatedCleanup = false) => {
    incomingRingtone.pause();
    outgoingRingtone.pause();

    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach(sender => {
        if (sender.track) sender.track.stop();
      });
      peerConnectionRef.current.getReceivers().forEach(receiver => {
        if (receiver.track) receiver.track.stop();
      });
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Only stop localStreamRef if it's a call-related cleanup
    // or if it's not currently being used for recording
    if (isCallRelatedCleanup && localStreamRef.current && !isRecording) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
    }
    
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    if (["ongoing", "calling"].includes(callStatus) && (partnerId || incomingCall?.caller.id)) {
      socket.emit("end_call", { partnerId: partnerId || incomingCall?.caller.id });
    }
    setCallStatus("idle");
    setIncomingCall(null);
  };
  // ... other call functions (startCall, acceptCall, rejectCall, toggleMedia) remain the same ...
  // Ensure they correctly use localStreamRef for camera/mic if it's shared.
  // For simplicity, this example assumes `startCall` gets a new stream.
  // If you want to reuse a recording stream for a call or vice-versa, more complex stream management is needed.

  const startCall = async (isVideo: boolean) => {
    if (isRecording) {
        alert("Please stop recording before starting a call.");
        return;
    }
    try {
      setCallStatus("calling");
      outgoingRingtone.play().catch(e => console.warn("Outgoing ringtone play failed:", e));

      // If a local stream exists (e.g., from a previous recording attempt that wasn't cleaned up, or a previous call)
      // stop its tracks before getting a new one for the call.
      // However, `endCall` should generally handle this.
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream; // This stream is for the call
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
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) endCall(true);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call_user", { calleeId: partnerId, offer, caller: { id: currentUser.id, firstName: currentUser.firstName }, isVideo });
    } catch (err) {
      console.error("Call error:", err);
      outgoingRingtone.pause();
      endCall(true);
      alert("Could not start call. Check permissions and devices.");
    }
  };

 const acceptCall = async () => {
    if (!incomingCall || isRecording) {
        if(isRecording) alert("Please stop recording before accepting a call.");
        return;
    }
    incomingRingtone.pause();
    try {
        // If a local stream exists (e.g., from a previous recording attempt that wasn't cleaned up)
        // stop its tracks before getting a new one for the call.
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incomingCall.isVideo });
        localStreamRef.current = stream; // This stream is for the call
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
            if (["disconnected", "failed", "closed"].includes(pc.connectionState)) endCall(true);
        };

        await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer_call", { callerId: incomingCall.caller.id, answer });

        setCallStatus("ongoing");
        setIncomingCall(null);
    } catch (err) {
        console.error("Accept call error:", err);
        endCall(true);
        alert("Could not accept call. Check permissions and devices.");
    }
 };

 const rejectCall = () => {
    incomingRingtone.pause();
    if (incomingCall) {
      socket.emit("reject_call", { callerId: incomingCall.caller.id });
      setIncomingCall(null);
      setCallStatus("idle");
    }
 };

 const toggleMedia = (type: "audio" | "video") => {
    if (!localStreamRef.current || !peerConnectionRef.current) return; // Ensure stream and call exists
    const trackKindToToggle = type; // 'audio' or 'video'
    const tracks = localStreamRef.current.getTracks().filter(track => track.kind === trackKindToToggle);
    
    if (tracks.length > 0) {
        const currentTrack = tracks[0];
        const newState = !currentTrack.enabled; // Toggle based on its current state
        currentTrack.enabled = newState;
        setLocalStreamEnabled(prev => ({ ...prev, [type]: newState }));

        // If it's video, also update the display of the local video element
        if (type === 'video' && localVideoRef.current) {
            localVideoRef.current.style.display = newState ? 'block' : 'none';
        }
    } else {
        console.warn(`No ${type} track found to toggle.`);
    }
 };
  // --- End WebRTC Call Functions ---

  // --- Message Rendering ---
  const renderMessageContent = (msg: Message) => {
    switch (msg.type) {
      case "image":
        return ( /* ... existing image rendering ... */
          <img
            src={msg.content}
            alt={msg.fileName || "Shared image"}
            className="max-w-xs max-h-60 rounded-md my-1 cursor-pointer"
            onClick={() => window.open(msg.content, "_blank")}
            onLoad={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          />
        );
      case "file":
        return ( /* ... existing file rendering ... */
          <a
            href={msg.content}
            target="_blank"
            rel="noopener noreferrer"
            download={msg.fileName}
            className="flex items-center gap-2 p-2 bg-gray-200 hover:bg-gray-300 rounded-md my-1"
          >
            <FaFileAlt  size={20} />
            <span className="text-sm text-blue-600 underline truncate">
              {msg.fileName || "Download File"}
            </span>
          </a>
        );
      case "audio": // New case for audio
        return (
          <div className="my-1">
            {msg.fileName && <p className="text-xs text-gray-500 mb-1 truncate">{msg.fileName}</p>}
            <audio controls src={msg.content} className="w-full max-w-xs">
              Your browser does not support the audio element.
            </audio>
            {/* Optionally display duration if available: msg.duration */}
          </div>
        );
      case "text":
      default:
        return <>{msg.content}</>;
    }
  };
  // --- End Message Rendering ---

  if (!currentUser?.id || !partnerId) { /* ... */ }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header ... (no changes) ... */}
      <div className="bg-emerald-700 text-white px-4 py-3 flex items-center gap-3 shadow">
        <button className="md:hidden" onClick={() => window.history.back()}>
          <BiArrowBack size={20} />
        </button>
        <div className="w-10 h-10 bg-white text-emerald-700 font-bold rounded-full flex items-center justify-center">
          {user?.firstName?.[0]?.toUpperCase() || 'U'}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{user?.firstName || "User"}</h2>
          <p className="text-xs text-gray-200">
            {callStatus === "ongoing" ? "On call" : (user?.isOnline ? "Online" : "Offline")}
          </p>
        </div>
        <div className="flex gap-4 text-white">
          <button onClick={() => startCall(false)} disabled={callStatus !== "idle" || uploadingFile || isRecording} title="Voice Call">
            <IoCall size={20} />
          </button>
          <button onClick={() => startCall(true)} disabled={callStatus !== "idle" || uploadingFile || isRecording} title="Video Call">
            <IoVideocam size={20} />
          </button>
          <button title="Search (Not implemented)">
            <FiSearch size={20} />
          </button>
          <button title="More options (Not implemented)">
            <FiMoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Messages ... (no changes to the mapping itself, only renderMessageContent) ... */}
       <div
        className="flex-1 overflow-y-auto px-4 py-2 space-y-2 bg-[#e5ded8]"
        style={{ backgroundImage: "url('https://web.whatsapp.com/img/bg-chat-tile-light_a4be512e7195b6b733d9110b408f075d.png')" }}
      >
        {messages.map((msg, idx) => (
          <div
            key={msg.id || idx}
            className={`flex ${msg.senderId === currentUser.id ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-lg px-3 py-2 max-w-xs md:max-w-md text-sm shadow ${msg.senderId === currentUser.id
                  ? "bg-emerald-100 text-gray-900 rounded-tr-none"
                  : "bg-white text-gray-900 rounded-tl-none"}`}
            >
              {renderMessageContent(msg)}
              <div className={`text-xs mt-1 text-right ${msg.senderId === currentUser.id ? "text-emerald-800 opacity-75" : "text-gray-500 opacity-75"}`}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>


      {/* Input Area --- MODIFIED --- */}
      <div className="px-4 py-3 bg-gray-100 flex items-center gap-2 relative">
        {showEmojiPicker && (
          <div ref={emojiPickerRef} className="absolute bottom-16 left-2 z-10">
            <EmojiPicker onEmojiClick={onEmojiClick} autoFocusSearch={false} height={350} width={300}/>
          </div>
        )}
        <button
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 disabled:opacity-50"
          title="Emoji"
          disabled={isRecording || callStatus !== 'idle'}
        >
          <FiSmile size={24} />
        </button>
        <input
          type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: "none" }}
          disabled={uploadingFile || isRecording || callStatus !== 'idle'}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 disabled:opacity-50"
          disabled={uploadingFile || isRecording || callStatus !== 'idle'}
          title="Attach file"
        >
          {uploadingFile && !isRecording ? ( // Show spinner only for file uploads, not during recording
            <div className="w-5 h-5 border-2 border-t-emerald-600 border-gray-200 rounded-full animate-spin"></div>
          ) : (
            <FiPaperclip size={24} />
          )}
        </button>

        {isRecording ? (
          <div className="flex-1 px-4 py-2 text-center text-red-600 animate-pulse bg-white rounded-full border border-gray-300">
            Recording... {formatTime(recordingDuration)}
          </div>
        ) : (
          <input
            type="text"
            className="flex-1 px-4 py-2 rounded-full bg-white border border-gray-300 focus:outline-none focus:border-emerald-500 disabled:bg-gray-200"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
            placeholder="Type a message"
            disabled={uploadingFile || isRecording || callStatus !== 'idle'}
          />
        )}

        <button
          onClick={() => {
            if (input.trim() && !isRecording) {
              sendMessage();
            } else if (!isRecording) {
              handleStartRecording();
            } else {
              handleStopRecording();
            }
          }}
          className={`p-2 rounded-full text-white ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-700 hover:bg-emerald-800'} disabled:bg-gray-400`}
          disabled={(uploadingFile && !isRecording) || callStatus !== 'idle'} // Allow stopping recording even if uploading another file
          title={input.trim() && !isRecording ? "Send message" : isRecording ? "Stop recording" : "Start recording"}
        >
          {input.trim() && !isRecording ? <FiSend size={24} /> : isRecording ? <FiSquare size={24} /> : <FiMic size={24} />}
        </button>
      </div>
      {/* End Input Area */}


      {/* Video Call UI ... (no functional changes, but ensure disabling call buttons when recording) ... */}
      {/* Incoming Call Modal ... (no changes) ... */}
       {(callStatus === "calling" || callStatus === "ongoing" || callStatus === "ringing") && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex flex-col items-center justify-center z-50 p-4">
          {/* ... (rest of the call UI structure remains the same) ... */}
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-contain bg-gray-900 rounded-lg ${callStatus === 'ongoing' && remoteVideoRef.current?.srcObject ? '' : 'hidden'}`}
            />
            {(callStatus === "calling" || callStatus === "ringing" || (callStatus === 'ongoing' && !remoteVideoRef.current?.srcObject)) && (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 rounded-lg">
                 <div className="w-40 h-40 bg-gray-700 text-emerald-400 font-bold rounded-full flex items-center justify-center mb-4 text-6xl">
                    {user?.firstName?.[0]?.toUpperCase() || incomingCall?.caller.firstName?.[0]?.toUpperCase() || 'P'}
                 </div>
                 <div className="text-white text-2xl font-semibold">
                    {callStatus === 'calling' ? user?.firstName : incomingCall?.caller.firstName || "Partner"}
                 </div>
              </div>
            )}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-40 h-30 md:w-48 md:h-36 bg-gray-800 rounded-lg absolute bottom-20 right-4 border-2 border-gray-700 shadow-xl"
              style={{ display: localStreamRef.current && localStreamEnabled.video && callStatus !== 'idle' ? 'block' : 'none' }}
            />
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-black bg-opacity-20 flex flex-col items-center">
            <div className="text-white mb-4 text-center">
              {callStatus === "calling" && ( <div className="text-xl animate-pulse">Calling {user?.firstName || "partner"}...</div> )}
              {callStatus === "ringing" && ( <div className="text-xl animate-pulse">Connecting to {incomingCall?.caller?.firstName || "caller"}...</div> )}
              {callStatus === "ongoing" && ( <div className="text-xl">{user?.firstName || incomingCall?.caller?.firstName || "On call"}</div> )}
            </div>
            <div className="flex gap-4">
               <button
                onClick={() => toggleMedia("audio")}
                className={`p-3 rounded-full ${localStreamEnabled.audio ? "bg-white text-gray-800" : "bg-red-500 text-white"} hover:opacity-80`}
                title={localStreamEnabled.audio ? "Mute Mic" : "Unmute Mic"} >
                {localStreamEnabled.audio ? ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path> <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path> <line x1="12" y1="19" x2="12" y2="23"></line> <line x1="8" y1="23" x2="16" y2="23"></line> </svg> ) : ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <line x1="1" y1="1" x2="23" y2="23"></line> <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path> <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path> <line x1="12" y1="19" x2="12" y2="23"></line> <line x1="8" y1="23" x2="16" y2="23"></line> </svg> )}
              </button>
              <button
                onClick={() => toggleMedia("video")}
                className={`p-3 rounded-full ${localStreamEnabled.video ? "bg-white text-gray-800" : "bg-red-500 text-white"} hover:opacity-80`}
                title={localStreamEnabled.video ? "Stop Video" : "Start Video"} >
                {localStreamEnabled.video ? ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <polygon points="23 7 16 12 23 17 23 7"></polygon> <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect> </svg> ) : ( <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <line x1="1" y1="1" x2="23" y2="23"></line> <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 2h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 0 1-5.66-5.66"></path> </svg> )}
              </button>
              <button onClick={() => endCall(true)} className="bg-red-600 text-white p-3 rounded-full hover:bg-red-700" title="End Call" >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path> <line x1="23" y1="1" x2="1" y2="23"></line> </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      {callStatus === "incoming" && incomingCall && (
         <div className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4">
          {/* ... (rest of incoming call modal remains the same) ... */}
           <div className="bg-white rounded-lg p-6 shadow-xl text-center w-full max-w-sm">
            <div className="w-24 h-24 bg-emerald-100 border-4 border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="text-emerald-700 text-4xl font-bold"> {incomingCall.caller.firstName?.[0]?.toUpperCase() || 'C'} </div>
            </div>
            <h2 className="text-2xl font-semibold mb-1">{incomingCall.caller.firstName || "Unknown Caller"}</h2>
            <p className="mb-3 text-gray-600">{incomingCall.isVideo ? "Incoming Video Call" : "Incoming Voice Call"}</p>
            <p className="mb-6 text-gray-500 animate-pulse">Ringing...</p>
            <div className="flex justify-center gap-6">
              <button onClick={rejectCall} className="bg-red-600 text-white p-4 rounded-full hover:bg-red-700" title="Reject Call" >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path> <line x1="23" y1="1" x2="1" y2="23"></line> </svg>
              </button>
              <button onClick={acceptCall} className="bg-emerald-600 text-white p-4 rounded-full hover:bg-emerald-700" title="Accept Call" >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path> </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import socket from "../socket"; // Directly import the pre-initialized socket instance
import axios from "axios"; // For file uploads
import EmojiPicker, { EmojiClickData } from "emoji-picker-react"; // Emoji picker
import { FiMoreVertical, FiSearch, FiPaperclip, FiMic, FiSmile, FiSend, FiSquare, FiCheck, FiCheckCircle } from "react-icons/fi"; // Added FiCheck, FiCheckCircle
import { IoCall, IoVideocam } from "react-icons/io5";
import { BiArrowBack } from "react-icons/bi";
import { FaFileAlt } from "react-icons/fa"; // For file icon
import { Toaster, toast } from 'sonner'; // Import Toaster and toast from sonner
import { debounce } from 'lodash'; // For debouncing typing events

interface IncomingCall {
  offer: RTCSessionDescriptionInit;
  caller: {
    id: string;
    firstName: string;
  };
  isVideo: boolean;
}

interface Message {
  id?: string; // Optional: for client-generated temporary IDs
  senderId: string;
  reciverId: string;
  content?: string; // Content is now optional for file messages
  createdAt: string;
  type: "text" | "image" | "file" | "audio";
  fileName?: string;
  duration?: number; // Optional: for audio/video duration
  isSeen?: boolean; // Added for seen status
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
  const [user, setUser] = useState<any>(null); // Partner user details
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "ringing" | "incoming" | "ongoing">("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStreamEnabled, setLocalStreamEnabled] = useState({ audio: true, video: true });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // --- Voice Recording State ---
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  // --- End Voice Recording State ---

  // --- Typing Indicator State ---
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  // --- End Typing Indicator State ---

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null); // For both call and recording streams
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null); // Ref for the messages scroll container

  // --- Voice Recording Refs ---
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any | null>(null);
  // --- End Voice Recording Refs ---

  const servers = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  // Debounced function for typing status
  const debouncedTypingStop = useCallback(
    debounce((receiverId: string) => { // Removed socket and senderId as arguments
      socket.emit("typing_stop", { receiverId });
    }, 1000), // Emit stop after 1 second of no typing
    []
  );

  // --- Main useEffect for Socket.IO setup and data fetching ---
  useEffect(() => {
    if (!currentUser?.id || !partnerId) {
      console.warn("Chat.tsx: currentUser.id or partnerId is missing.");
      return;
    }

    // The socket is already initialized and connected by ../socket.js
    // We just need to ensure it's ready and then join the room.
    if (!socket.connected) {
      // This case should ideally not happen if socket.js connects on import,
      // but as a fallback, we can try to connect here.
      // However, for a global socket, it's better to let the global file manage connection.
      // For now, we'll assume it's connected or will connect shortly.
      console.log("Chat.tsx: Socket not yet connected, waiting...");
    }

    // Emit join_chat_room once the component mounts and IDs are available
    socket.emit("join_chat_room", { user1Id: currentUser.id, user2Id: partnerId });
    console.log("Chat.tsx: Emitted join_chat_room with userId:", currentUser.id);

    // Event listeners for socket connection status (optional, for logging)
    const handleConnect = () => {
      console.log("Chat.tsx: Socket connected successfully with ID:", socket.id);
    };
    const handleConnectError = (err: Error) => {
      console.error("Chat.tsx: Socket connection error:", err.message);
      toast.error(`Socket connection failed: ${err.message}`);
    };

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);


    // Fetch messages and partner details
    const fetchMessages = async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/v1/messages/${currentUser.id}/${partnerId}`);
        if (!res.ok) throw new Error('Failed to fetch messages');
        const data = await res.json();
        const typedMessages = data.map((msg: any) => ({
          ...msg,
          type: msg.type || 'text', // Default to 'text' if type is missing
          isSeen: msg.isSeen || false, // Ensure isSeen property exists
        }));
        setMessages(typedMessages);
      } catch (error) {
        console.error("Error fetching messages:", error);
        toast.error("Failed to load messages.");
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
        toast.error("Failed to load partner details.");
      }
    };

    fetchMessages();
    fetchPartner();

    // Socket event handlers
    const handleReceiveMessage = (msg: Message) => {
      setMessages(prev => {
        // Prevent adding duplicate messages if the server echoes them back and they already exist by ID
        // This is crucial if you optimistically add messages on send and then receive them back
        if (msg.id && prev.some(existingMsg => existingMsg.id === msg.id)) {
          return prev;
        }
        return [...prev, { ...msg, type: msg.type || 'text', isSeen: msg.isSeen || false }];
      });
    };

    const handleReceiveCall = ({ offer, caller, isVideo }: IncomingCall) => {
      setCallStatus("incoming");
      setIncomingCall({ offer, caller, isVideo });
      incomingRingtone.play().catch(e => console.warn("Incoming ringtone play failed:", e));
    };

    const handleCallAnswered = async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
      if (!peerConnectionRef.current) return;
      outgoingRingtone.pause();
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus("ongoing");
      } catch (e) {
        console.error("Error setting remote description for answer:", e);
        toast.error("Failed to establish call connection.");
        endCall(true);
      }
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
      toast.info("Call ended.");
    };

    const handleCallRejected = () => {
      outgoingRingtone.pause();
      setCallStatus("idle");
      toast.info(`${user?.firstName || "User"} is busy or rejected your call.`);
    };

    // --- New: Typing and Online/Offline Status Handlers ---
    const handlePartnerTyping = ({ senderId, isTyping }: { senderId: string; isTyping: boolean }) => {
      if (senderId === partnerId) {
        setPartnerIsTyping(isTyping);
      }
    };

    const handleUserStatus = ({ userId: statusUserId, status }: { userId: string; status: "online" | "offline" }) => {
      if (statusUserId === partnerId) {
        setUser((prevUser: any) => ({ ...prevUser, isOnline: status === "online" }));
      }
    };

    const handleMessageSeenReceipt = ({ messageId, seenBy }: { messageId: string; seenBy: string }) => {
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === messageId && msg.senderId === currentUser.id
            ? { ...msg, isSeen: true }
            : msg
        )
      );
    };
    // --- End: Typing and Online/Offline Status Handlers ---


    // Register socket listeners
    socket.on("receive_message", handleReceiveMessage);
    socket.on("receive_call", handleReceiveCall);
    socket.on("call_answered", handleCallAnswered);
    socket.on("ice_candidate", handleIceCandidate);
    socket.on("call_ended", handleCallEnded);
    socket.on("call_rejected", handleCallRejected);
    socket.on("partner_typing", handlePartnerTyping); // New listener
    socket.on("user_status", handleUserStatus);       // New listener
    socket.on("message_seen_receipt", handleMessageSeenReceipt); // New listener
    socket.on("error", (err: { message: string }) => { // Generic error from backend
      console.error("Socket error from server:", err.message);
      toast.error(`Server error: ${err.message}`);
    });


    // Cleanup function for useEffect
    return () => {
      // Turn off only the listeners specific to this component instance
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("receive_message", handleReceiveMessage);
      socket.off("receive_call", handleReceiveCall);
      socket.off("call_answered", handleCallAnswered);
      socket.off("ice_candidate", handleIceCandidate);
      socket.off("call_ended", handleCallEnded);
      socket.off("call_rejected", handleCallRejected);
      socket.off("partner_typing", handlePartnerTyping);
      socket.off("user_status", handleUserStatus);
      socket.off("message_seen_receipt", handleMessageSeenReceipt);
      socket.off("error");

      incomingRingtone.pause();
      outgoingRingtone.pause();
      endCall(true); // Ensure all call-related resources are cleaned up
      // Recording specific cleanup
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      debouncedTypingStop.cancel(); // Cancel any pending debounced calls
      // Do NOT call socket.disconnect() here, as the socket is global and managed externally.
    };
  }, [currentUser.id, partnerId, user?.firstName, debouncedTypingStop]); // Dependencies for this useEffect

  // Effect for scrolling to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Effect for handling click outside emoji picker
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

  // Effect for message seen status (IntersectionObserver)
  useEffect(() => {
    if (!socket || !messagesContainerRef.current) return; // Use directly imported socket

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const messageElement = entry.target as HTMLDivElement;
            const messageId = messageElement.dataset.messageId;
            const messageSenderId = messageElement.dataset.senderId;

            // Only mark as seen if the message is from the partner and not already seen
            if (messageId && messageSenderId === partnerId) {
              const messageToMark = messages.find(msg => msg.id === messageId);
              if (messageToMark && !messageToMark.isSeen) {
                socket.emit("message_seen", { messageId, senderId: partnerId }); // Use directly imported socket
              }
            }
          }
        });
      },
      {
        root: messagesContainerRef.current, // Observe within the messages container
        rootMargin: '0px',
        threshold: 0.9, // Message is considered "seen" when 90% visible
      }
    );

    // Observe only the last message from the partner that hasn't been seen yet
    const unseenPartnerMessages = messages.filter(msg => msg.senderId === partnerId && !msg.isSeen);
    if (unseenPartnerMessages.length > 0) {
      const lastUnseenPartnerMessage = unseenPartnerMessages[unseenPartnerMessages.length - 1];
      const lastUnseenPartnerMessageElement = document.querySelector(`[data-message-id="${lastUnseenPartnerMessage.id}"]`);
      if (lastUnseenPartnerMessageElement) {
        observer.observe(lastUnseenPartnerMessageElement);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [messages, partnerId, currentUser.id]); // Removed getSocket from dependencies

  const sendMessage = () => {
    if (!socket || !input.trim() || isRecording) return; // Use directly imported socket

    const msg: Message = {
      senderId: currentUser.id,
      reciverId: partnerId!,
      content: input,
      createdAt: new Date().toISOString(),
      type: "text",
    };
    socket.emit("send_message", msg);
    // Removed immediate local state update.
    // Rely on the 'receive_message' event from the backend to add it.
    setInput("");
    setShowEmojiPicker(false);
    debouncedTypingStop.cancel(); // Cancel any pending typing_stop
    socket.emit("typing_stop", { receiverId: partnerId }); // Explicitly send stop typing
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

      const { url, fileName: returnedFileName } = res.data;
      const fileMsg: Message = {
        senderId: currentUser.id,
        reciverId: partnerId!,
        content: url, // For files, content is the URL
        createdAt: new Date().toISOString(),
        type: type,
        fileName: returnedFileName || file.name,
        duration: type === 'audio' ? recordingDuration : undefined // Include duration for audio
      };

      if (socket) { // Use directly imported socket
        socket.emit("send_message", fileMsg);
      } else {
        toast.error("Socket not connected to send file message.");
      }
    } catch (error) {
      console.error(`${type} upload error:`, error);
      toast.error(`${type} upload failed. Please try again.`);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) { // Always clear file input
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (socket && !isRecording && callStatus === 'idle') { // Use directly imported socket
      // Emit typing_start immediately
      socket.emit("typing_start", { receiverId: partnerId }); // Send receiverId
      // Schedule typing_stop after a delay
      debouncedTypingStop(partnerId); // Removed socket and senderId arguments
    }
  };

  // --- Voice Recording Functions ---
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartRecording = async () => {
    if (isRecording) return; // Already recording
    if (callStatus !== 'idle') {
      toast.info("Cannot record during a call.");
      return;
    }

    try {
      // Ensure any previous local stream (e.g., from a disconnected call) is stopped
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream; // Store the stream specifically for recording
      setIsRecording(true);
      setRecordingDuration(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      audioChunksRef.current = [];
      const availableMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ];
      let selectedMimeType = '';
      for (const type of availableMimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }

      if (!selectedMimeType) {
        throw new Error("No supported audio MIME type found for MediaRecorder.");
      }

      const currentMediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      mediaRecorderRef.current = currentMediaRecorder;

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const finalMimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });
        const audioFile = new File([audioBlob], `voice-message-${Date.now()}.webm`, { type: finalMimeType });
        uploadAndSendFile(audioFile, "audio");
        audioChunksRef.current = [];

        // Stop the tracks of the stream obtained specifically for recording
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
        }
      };

      mediaRecorderRef.current.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        toast.error("Recording failed: " + (event as any).error.name + " - " + (event as any).error.message);
        handleStopRecording(); // Attempt to stop and reset on error
      };

      mediaRecorderRef.current.start();
      console.log("Recording started with MIME type:", selectedMimeType);

    } catch (err) {
      console.error("Error starting recording:", err);
      toast.error("Could not start recording. Please ensure microphone access is allowed and your browser supports it.");
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setRecordingDuration(0);
      // Ensure stream is stopped if it was created but recording failed to start
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop(); // This will trigger the 'onstop' event
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setRecordingDuration(0); // Reset duration after stopping
    }
  };
  // --- End Voice Recording Functions ---

  // --- WebRTC Call Functions ---
  const endCall = (isCallRelatedCleanup = false) => {
    incomingRingtone.pause();
    outgoingRingtone.pause();

    if (peerConnectionRef.current) {
      peerConnectionRef.current.getSenders().forEach(sender => {
        if (sender.track) sender.track.stop(); // Stop tracks associated with the sender
      });
      // No need to stop receiver tracks explicitly, they stop when PC closes
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop local media stream only if it's a call-related cleanup
    // AND it's not currently being used for active recording.
    if (localStreamRef.current && (isCallRelatedCleanup || !isRecording)) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    // Emit end_call to partner if the call was ongoing or being initiated
    if (["ongoing", "calling"].includes(callStatus) && (partnerId || incomingCall?.caller.id)) {
      if (socket) { // Use directly imported socket
        socket.emit("end_call", { partnerId: partnerId || incomingCall?.caller.id });
      }
    }
    setCallStatus("idle");
    setIncomingCall(null);
    setLocalStreamEnabled({ audio: true, video: true }); // Reset media controls
  };

  const startCall = async (isVideo: boolean) => {
    if (isRecording) {
      toast.info("Please stop recording before starting a call.");
      return;
    }
    if (callStatus !== "idle") {
      toast.info("Already in a call or call state is not idle.");
      return;
    }

    if (!socket) return; // Use directly imported socket

    try {
      setCallStatus("calling");
      outgoingRingtone.play().catch(e => console.warn("Outgoing ringtone play failed:", e));

      // Stop any existing local stream before getting a new one for the call
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream; // This stream is for the call
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setLocalStreamEnabled({ audio: true, video: isVideo }); // Set initial state for controls

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
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          console.log("Peer connection state changed:", pc.connectionState);
          endCall(true);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call_user", { calleeId: partnerId, offer, caller: { id: currentUser.id, firstName: currentUser.firstName }, isVideo });
    } catch (err) {
      console.error("Call error:", err);
      outgoingRingtone.pause();
      endCall(true);
      toast.error("Could not start call. Check permissions and devices.");
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || isRecording) {
      if (isRecording) toast.info("Please stop recording before accepting a call.");
      return;
    }
    incomingRingtone.pause();

    if (!socket) return; // Use directly imported socket

    try {
      // Stop any existing local stream before getting a new one for the call
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: incomingCall.isVideo });
      localStreamRef.current = stream; // This stream is for the call
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setLocalStreamEnabled({ audio: true, video: incomingCall.isVideo }); // Set initial state for controls

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
        if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
          console.log("Peer connection state changed:", pc.connectionState);
          endCall(true);
        }
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
      toast.error("Could not accept call. Check permissions and devices.");
    }
  };

  const rejectCall = () => {
    incomingRingtone.pause();
    if (incomingCall) {
      if (socket) { // Use directly imported socket
        socket.emit("reject_call", { callerId: incomingCall.caller.id });
      }
      setIncomingCall(null);
      setCallStatus("idle");
      toast.info("Call rejected.");
    }
  };

  const toggleMedia = (type: "audio" | "video") => {
    if (!localStreamRef.current) {
      toast.error(`Cannot toggle ${type}: No local stream available.`);
      return;
    }
    const tracks = localStreamRef.current.getTracks().filter(track => track.kind === type);

    if (tracks.length > 0) {
      const currentTrack = tracks[0];
      const newState = !currentTrack.enabled;
      currentTrack.enabled = newState;
      setLocalStreamEnabled(prev => ({ ...prev, [type]: newState }));

      if (type === 'video' && localVideoRef.current) {
        localVideoRef.current.style.display = newState ? 'block' : 'none';
      }
      toast.info(`${type === 'audio' ? 'Microphone' : 'Camera'} ${newState ? 'enabled' : 'disabled'}.`);
    } else {
      toast.error(`No ${type} track found to toggle.`);
    }
  };
  // --- End WebRTC Call Functions ---

  // --- Message Rendering ---
  const renderMessageContent = (msg: Message) => {
    switch (msg.type) {
      case "image":
        return (
          <img
            src={msg.content}
            alt={msg.fileName || "Shared image"}
            className="max-w-xs max-h-60 rounded-md my-1 cursor-pointer object-contain"
            onClick={() => window.open(msg.content, "_blank")}
            onLoad={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          />
        );
      case "file":
        return (
          <a
            href={msg.content}
            target="_blank"
            rel="noopener noreferrer"
            download={msg.fileName}
            className="flex items-center gap-2 p-2 bg-gray-200 hover:bg-gray-300 rounded-md my-1"
          >
            <FaFileAlt size={20} />
            <span className="text-sm text-blue-600 underline truncate">
              {msg.fileName || "Download File"}
            </span>
          </a>
        );
      case "audio":
        return (
          <div className="my-1">
            {msg.fileName && <p className="text-xs text-gray-500 mb-1 truncate">{msg.fileName}</p>}
            <audio controls src={msg.content} className="w-full max-w-xs">
              Your browser does not support the audio element.
            </audio>
          </div>
        );
      case "text":
      default:
        return <>{msg.content}</>;
    }
  };
  // --- End Message Rendering ---

  // Basic check for user and partner IDs before rendering the main chat UI
  if (!currentUser?.id || !partnerId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 text-gray-600">
        <p>Please ensure you are logged in and a chat partner is selected.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-inter">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <div className="bg-emerald-700 text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <button className="md:hidden" onClick={() => window.history.back()} title="Back">
          <BiArrowBack size={20} />
        </button>
        <div className="w-10 h-10 bg-white text-emerald-700 font-bold rounded-full flex items-center justify-center">
          {user?.firstName?.[0]?.toUpperCase() || 'U'}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{user?.firstName || "User"}</h2>
          <p className="text-xs text-gray-200">
            {callStatus === "ongoing"
              ? "On call"
              : partnerIsTyping
                ? "Typing..."
                : (user?.isOnline ? "Online" : "Offline")}
          </p>
        </div>
        <div className="flex gap-4 text-white">
          <button onClick={() => startCall(false)} disabled={callStatus !== "idle" || uploadingFile || isRecording} title="Voice Call">
            <IoCall size={20} />
          </button>
          <button onClick={() => startCall(true)} disabled={callStatus !== "idle" || uploadingFile || isRecording} title="Video Call">
            <IoVideocam size={20} />
          </button>
          <button title="Search (Not implemented)" disabled={callStatus !== "idle"}>
            <FiSearch size={20} />
          </button>
          <button title="More options (Not implemented)" disabled={callStatus !== "idle"}>
            <FiMoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={messagesContainerRef} // Assign ref to the scrollable container
        className="flex-1 overflow-y-auto px-4 py-2 space-y-2 bg-[#e5ded8] flex flex-col"
        style={{ backgroundImage: "url('https://web.whatsapp.com/img/bg-chat-tile-light_a4be512e7195b6b733d9110b408f075d.png')", backgroundSize: 'repeat' }}
      >
        {messages.map((msg, idx) => (
          <div
            key={msg.id || idx}
            data-message-id={msg.id} // Add data attribute for IntersectionObserver
            data-sender-id={msg.senderId} // Add sender ID for observer
            className={`flex ${msg.senderId === currentUser.id ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-lg px-3 py-2 max-w-[75%] md:max-w-[60%] text-sm shadow-md relative
                ${msg.senderId === currentUser.id
                  ? "bg-emerald-100 text-gray-900 rounded-br-none"
                  : "bg-white text-gray-900 rounded-bl-none"}`}
            >
              {renderMessageContent(msg)}
              <div className={`text-xs mt-1 text-right flex items-center justify-end gap-1 ${msg.senderId === currentUser.id ? "text-emerald-800 opacity-75" : "text-gray-500 opacity-75"}`}>
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {msg.senderId === currentUser.id && (
                  msg.isSeen ? (
                    <FiCheckCircle size={14} title="Seen" /> // Double checkmark for seen
                  ) : (
                    <FiCheck size={14}  title="Delivered" /> // Single checkmark for delivered
                  )
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-4 py-3 bg-gray-100 flex items-center gap-2 relative shadow-inner">
        {showEmojiPicker && (
          <div ref={emojiPickerRef} className="absolute bottom-full left-2 mb-2 z-10">
            <EmojiPicker onEmojiClick={onEmojiClick} autoFocusSearch={false} height={350} width={300} />
          </div>
        )}
        <button
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors duration-200"
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
          className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 disabled:opacity-50 transition-colors duration-200"
          disabled={uploadingFile || isRecording || callStatus !== 'idle'}
          title="Attach file"
        >
          {uploadingFile ? (
            <div className="w-5 h-5 border-2 border-t-emerald-600 border-gray-200 rounded-full animate-spin"></div>
          ) : (
            <FiPaperclip size={24} />
          )}
        </button>

        {isRecording ? (
          <div className="flex-1 px-4 py-2 text-center text-red-600 animate-pulse bg-white rounded-full border border-gray-300 flex items-center justify-center">
            <FiMic size={20} /> Recording... {formatTime(recordingDuration)}
          </div>
        ) : (
          <input
            type="text"
            className="flex-1 px-4 py-2 rounded-full bg-white border border-gray-300 focus:outline-none focus:border-emerald-500 disabled:bg-gray-200 transition-colors duration-200"
            value={input}
            onChange={handleInputChange} // Use new handler for typing status
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
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
          className={`p-2 rounded-full text-white transition-colors duration-200 shadow-md
            ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-700 hover:bg-emerald-800'}
            ${(uploadingFile && !isRecording) || callStatus !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          disabled={(uploadingFile && !isRecording) || callStatus !== 'idle'}
          title={input.trim() && !isRecording ? "Send message" : isRecording ? "Stop recording" : "Start recording"}
        >
          {input.trim() && !isRecording ? <FiSend size={24} /> : isRecording ? <FiSquare size={24} /> : <FiMic size={24} />}
        </button>
      </div>
      {/* End Input Area */}


      {/* Video Call UI */}
      {(callStatus === "calling" || callStatus === "ongoing" || callStatus === "ringing") && (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex flex-col items-center justify-center z-50 p-4">
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-contain bg-gray-900 rounded-lg ${callStatus === 'ongoing' && remoteVideoRef.current?.srcObject ? '' : 'hidden'}`}
            />
            {(callStatus === "calling" || callStatus === "ringing" || (callStatus === 'ongoing' && !remoteVideoRef.current?.srcObject)) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 rounded-lg">
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
              {callStatus === "calling" && (<div className="text-xl animate-pulse">Calling {user?.firstName || "partner"}...</div>)}
              {callStatus === "ringing" && (<div className="text-xl animate-pulse">Connecting to {incomingCall?.caller?.firstName || "caller"}...</div>)}
              {callStatus === "ongoing" && (<div className="text-xl">{user?.firstName || incomingCall?.caller?.firstName || "On call"}</div>)}
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => toggleMedia("audio")}
                className={`p-3 rounded-full ${localStreamEnabled.audio ? "bg-white text-gray-800" : "bg-red-500 text-white"} hover:opacity-80 transition-colors duration-200`}
                title={localStreamEnabled.audio ? "Mute Mic" : "Unmute Mic"} >
                {localStreamEnabled.audio ? (<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path> <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path> <line x1="12" y1="19" x2="12" y2="23"></line> <line x1="8" y1="23" x2="16" y2="23"></line> </svg>) : (<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <line x1="1" y1="1" x2="23" y2="23"></line> <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path> <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path> <line x1="12" y1="19" x2="12" y2="23"></line> <line x1="8" y1="23" x2="16" y2="23"></line> </svg>)}
              </button>
              <button
                onClick={() => toggleMedia("video")}
                className={`p-3 rounded-full ${localStreamEnabled.video ? "bg-white text-gray-800" : "bg-red-500 text-white"} hover:opacity-80 transition-colors duration-200`}
                title={localStreamEnabled.video ? "Stop Video" : "Start Video"} >
                {localStreamEnabled.video ? (<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <polygon points="23 7 16 12 23 17 23 7"></polygon> <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect> </svg>) : (<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <line x1="1" y1="1" x2="23" y2="23"></line> <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 2h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 0 1-5.66-5.66"></path> </svg>)}
              </button>
              <button onClick={() => endCall(true)} className="bg-red-600 text-white p-3 rounded-full hover:bg-red-700 transition-colors duration-200" title="End Call" >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path> <line x1="23" y1="1" x2="1" y2="23"></line> </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Incoming Call Modal */}
      {callStatus === "incoming" && incomingCall && (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 shadow-xl text-center w-full max-w-sm">
            <div className="w-24 h-24 bg-emerald-100 border-4 border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <div className="text-emerald-700 text-4xl font-bold"> {incomingCall.caller.firstName?.[0]?.toUpperCase() || 'C'} </div>
            </div>
            <h2 className="text-2xl font-semibold mb-1">{incomingCall.caller.firstName || "Unknown Caller"}</h2>
            <p className="mb-3 text-gray-600">{incomingCall.isVideo ? "Incoming Video Call" : "Incoming Voice Call"}</p>
            <p className="mb-6 text-gray-500 animate-pulse">Ringing...</p>
            <div className="flex justify-center gap-6">
              <button onClick={rejectCall} className="bg-red-600 text-white p-4 rounded-full hover:bg-red-700 transition-colors duration-200" title="Reject Call" >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path> <line x1="23" y1="1" x2="1" y2="23"></line> </svg>
              </button>
              <button onClick={acceptCall} className="bg-emerald-600 text-white p-4 rounded-full hover:bg-emerald-700 transition-colors duration-200" title="Accept Call" >
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

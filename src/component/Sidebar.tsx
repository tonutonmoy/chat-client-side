import React from "react";
import { Link } from "react-router-dom";
import Users from "./Users";

const Sidebar = () => {
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  return (
    <div className="w-64 bg-white h-full border-r flex flex-col justify-between">
      {/* 🔼 Top: Chat/User List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b text-lg font-semibold text-center">MyChat</div>
        <Users />
      </div>

      {/* 🔽 Bottom: Profile Section */}
      <Link
        to="/profile"
        className="flex items-center gap-3 p-4 border-t hover:bg-gray-100"
      >
        {currentUser?.profileImage ? (
          <img
            src={currentUser.profileImage}
            alt="Profile"
            className="w-10 h-10 rounded-full object-cover border"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-lg">
            {currentUser?.firstName?.[0] || "U"}
          </div>
        )}

        <div className="flex flex-col">
          <span className="font-medium">{currentUser?.firstName || "User"}</span>
          <span className="text-xs text-gray-500">View Profile</span>
        </div>
      </Link>
    </div>
  );
};

export default Sidebar;

import React from "react";
import { Link } from "react-router-dom";
import Users from "./Users";
import { FiMoreVertical, FiSearch } from "react-icons/fi";
import { BsFilter } from "react-icons/bs";

const Sidebar = () => {
  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  return (
    <div className="w-80 bg-[#f0f2f5] h-full border-r border-gray-300 flex flex-col">
      {/* 🔼 Top: Header */}
      <div className="bg-[#f0f2f5] p-3 flex justify-between items-center border-b border-gray-300">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold text-gray-800">WhatsApp</span>
        </div>
        <div className="flex items-center gap-4 text-gray-600">
          <button className="p-1 hover:bg-gray-200 rounded-full">
            <BsFilter size={20} />
          </button>
          <button className="p-1 hover:bg-gray-200 rounded-full">
            <FiMoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* 🔼 Search Bar */}
      <div className="p-2 bg-white">
        <div className="bg-[#f0f2f5] rounded-lg flex items-center px-3 py-1">
          <FiSearch  />
          <input
            type="text"
            placeholder="Search or start new chat"
            className="bg-transparent w-full py-2 outline-none text-sm"
          />
        </div>
      </div>

      {/* 🔼 Chat/User List */}
      <div className="flex-1 overflow-y-auto bg-white">
        <Users />
      </div>

      {/* 🔽 Bottom: Account Section */}
      <div className="bg-[#f0f2f5] p-3 border-t border-gray-300">
        <Link
          to="/profile"
          className="flex items-center gap-3 p-2 hover:bg-gray-200 rounded-lg transition-colors"
        >
          {currentUser?.profileImage ? (
            <img
              src={currentUser.profileImage}
              alt="Profile"
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-bold text-lg">
              {currentUser?.firstName?.[0]?.toUpperCase() || "U"}
            </div>
          )}
          <div className="flex flex-col">
            <span className="font-medium text-gray-800">
              {currentUser?.firstName || "User"}
            </span>
            <span className="text-xs text-gray-500">My Account</span>
          </div>
        </Link>
      </div>
    </div>
  );
};

export default Sidebar;
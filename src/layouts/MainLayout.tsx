import React from "react"; // ✅ Add this line
import { Outlet } from "react-router-dom";
import Sidebar from "../component/Sidebar";



const MainLayout = () => {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-hidden">
       
        <Outlet />
      </div>
    </div>
  );
};

export default MainLayout;
